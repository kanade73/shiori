import { getEntities, getSources } from "./works";
import { normalizeText } from "./claims";
import type { SourceChunk, WorkSource } from "./types";

/**
 * 会話の話題を調べる外部の知識源（issue #14）。work.json の `sources` に書かれた
 * MediaWiki の記事を取ってきて段落単位に区切り、ユーザーの発話との文字 bigram の
 * 重なりで関連する段落を選ぶ。
 *
 * ベクトルDBや埋め込みは使わない（AGENTS.md: 単一ユーザー・記事数本の規模に対して過剰）。
 * 日本語は分かち書きが無いので、単語ではなく文字の2-gramで重なりを見る。
 */

const USER_AGENT = "misdirection-chat/0.1 (hackathon app; looks up the scene a user wants to talk about)";
const FETCH_TIMEOUT_MS = 8000;
// 記事はそう頻繁に変わらない。セッションごとに取り直さないよう、プロセス内で持っておく
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const MAX_CHUNK_CHARS = 600;
/** これ以下の長さで句点で終わらない行は、段落の見出し（「『〇〇』編」やキャラ名）とみなす */
const LABEL_MAX_CHARS = 30;
// 本文ではない章（出典の一覧など）。作品ではなく MediaWiki の記事の慣習
const SKIP_HEADINGS = /^(脚注|注釈|出典|参考文献|外部リンク|関連項目)/;

/** ひらがなだけの bigram（助詞など）は、どの段落にも出てくるので軽く見る */
const KANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;
const KANA_ONLY_WEIGHT = 0.3;

type CacheEntry = { fetchedAt: number; chunks: SourceChunk[] };
const cache = new Map<string, CacheEntry>();

/** テスト用 */
export function clearSourceCache() {
  cache.clear();
}

/**
 * MediaWiki の TextExtracts が返すプレーンテキスト（見出しは `== 章 ==`）を段落単位に区切る。
 * 短い行は段落の見出しとして次の本文とひとまとめにし、長い段落は見出しを引き継いで分割する。
 */
export function chunkArticle(extract: string, meta: { sourceTitle: string; url: string; idPrefix: string }): SourceChunk[] {
  const chunks: SourceChunk[] = [];
  const headingStack: string[] = [];
  let label = "";
  let lines: string[] = [];
  let length = 0;
  let hasBody = false;

  const heading = () => headingStack.filter(Boolean).join(" / ");
  const skipping = () => headingStack.some((h) => SKIP_HEADINGS.test(h));

  const flush = () => {
    const text = lines.join("\n").trim();
    if (text && !skipping()) {
      chunks.push({
        id: `${meta.idPrefix}-${chunks.length + 1}`,
        sourceTitle: meta.sourceTitle,
        url: meta.url,
        heading: heading(),
        label,
        text,
      });
    }
    lines = [];
    length = 0;
    hasBody = false;
  };

  for (const raw of extract.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const headingMatch = line.match(/^(=+)\s*(.+?)\s*=+$/);
    if (headingMatch) {
      flush();
      label = "";
      // `==` が章（深さ0）。それより深い見出しは親の章名に続けて持つ
      const depth = Math.max(0, headingMatch[1].length - 2);
      headingStack.length = depth;
      headingStack[depth] = headingMatch[2];
      continue;
    }

    const isLabel = line.length <= LABEL_MAX_CHARS && !/[。．]$/.test(line);
    if (isLabel) {
      if (hasBody) {
        // 本文の後の短い行は、次の段落の見出し
        flush();
        label = line;
      } else if (!label) {
        label = line;
      } else if (length + line.length > MAX_CHUNK_CHARS) {
        // 短い行だけが続く（スタッフの一覧など）。見出しは引き継いで分割する
        flush();
      }
      lines.push(line);
      length += line.length + 1; // 改行の分も数える
      continue;
    }

    if (hasBody && length + line.length > MAX_CHUNK_CHARS) {
      flush();
      // 同じ段落の続き。見出しは引き継ぐ
    }
    lines.push(line);
    length += line.length + 1; // 改行の分も数える
    hasBody = true;
  }
  flush();

  return chunks;
}

function pageUrl(endpoint: string, page: string): string {
  // https://ja.wikipedia.org/w/api.php → https://ja.wikipedia.org/wiki/<記事名>
  const base = endpoint.replace(/\/w\/api\.php$/, "/wiki/");
  return `${base}${encodeURIComponent(page.replaceAll(" ", "_"))}`;
}

async function fetchMediaWikiChunks(source: WorkSource, idPrefix: string): Promise<SourceChunk[]> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts|info",
    explaintext: "1",
    exsectionformat: "wiki",
    inprop: "url",
    redirects: "1",
    format: "json",
    formatversion: "2",
    titles: source.page,
  });
  const res = await fetch(`${source.endpoint}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${source.endpoint} ${source.page}: HTTP ${res.status}`);

  const body = (await res.json()) as {
    query?: { pages?: { title?: string; extract?: string; fullurl?: string; missing?: boolean }[] };
  };
  const page = body.query?.pages?.[0];
  if (!page || page.missing || !page.extract) throw new Error(`${source.endpoint} ${source.page}: page not found`);

  const title = page.title ?? source.page;
  return chunkArticle(page.extract, {
    sourceTitle: title,
    url: page.fullurl ?? pageUrl(source.endpoint, title),
    idPrefix,
  });
}

/** `sections` が書かれていれば、その章と記事冒頭の導入（見出しの無い段落）だけを残す */
function inSections(chunk: SourceChunk, sections: string[] | undefined): boolean {
  if (!sections) return true;
  const chapter = chunk.heading.split(" / ")[0];
  return chapter === "" || sections.includes(chapter);
}

async function loadChunksOf(source: WorkSource, idPrefix: string): Promise<SourceChunk[]> {
  const key = `${source.endpoint}|${source.page}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.chunks;
  try {
    const chunks = await fetchMediaWikiChunks(source, idPrefix);
    cache.set(key, { fetchedAt: Date.now(), chunks });
    return chunks;
  } catch (error) {
    console.error("外部の知識源の取得に失敗:", error);
    // 古いキャッシュがあれば、無いよりはまし
    return cached?.chunks ?? [];
  }
}

/** 作品の外部知識源を全部、段落に区切って返す。取れなかった記事は飛ばす（ログだけ残す）。 */
export async function loadSourceChunks(workId: string): Promise<SourceChunk[]> {
  const sources = getSources(workId);
  const results = await Promise.all(
    sources.map(async (source, index) =>
      (await loadChunksOf(source, `src${index + 1}`)).filter((c) => inSections(c, source.sections)),
    ),
  );
  return results.flat();
}

function bigrams(text: string): Set<string> {
  const compact = normalizeText(text).replace(/[^\p{L}\p{N}]/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i + 1 < compact.length; i++) grams.add(compact.slice(i, i + 2));
  return grams;
}

/**
 * 発話に出てきた登場人物の正式名（work.json の entities）。別名で書かれていても
 * 正式名で探せるようにし（「ハチ」→「ハチワレ」）、ひらがなの名前（うさぎ）も助詞と同じ扱いにしない。
 */
export function mentionedNames(workId: string, query: string): string[] {
  const text = normalizeText(query);
  return getEntities(workId)
    .filter((entity) =>
      [entity.name, ...entity.aliases].some((form) => {
        const f = normalizeText(form);
        return f.length > 0 && text.includes(f);
      }),
    )
    .map((entity) => entity.name);
}

export type RankedChunk = { chunk: SourceChunk; score: number };

// 長い段落ほど偶然の重なりが増えるので、平均との長さの比で少し割り引く（BM25 の b にあたる）
const LENGTH_NORMALIZATION = 0.5;
/** 段落の見出しがそのまま登場人物の名前なら、その人物の段落 */
const NAME_LABEL_BONUS = 2;

/**
 * 文字 bigram の重なりを IDF で重み付けした点数で段落を並べる。段落の見出しに
 * 重なる分はもう一度数える（「草むしり検定のところ」→ 『草むしり検定』編の段落）。
 * `names` は発話に出てきた登場人物の正式名で、別名で書かれていてもこれで探す。
 */
export function rankChunks(query: string, chunks: SourceChunk[], names: string[] = []): RankedChunk[] {
  const nameGrams = bigrams(names.join(" "));
  const queryGrams = new Set([...bigrams(query), ...nameGrams]);
  if (queryGrams.size === 0 || chunks.length === 0) return [];

  const chunkGrams = chunks.map((c) => ({ body: bigrams(`${c.label}\n${c.text}`), label: bigrams(c.label) }));
  const df = new Map<string, number>();
  for (const { body } of chunkGrams) {
    for (const g of queryGrams) if (body.has(g)) df.set(g, (df.get(g) ?? 0) + 1);
  }
  const weight = (g: string) => {
    const idf = Math.log(1 + chunks.length / (df.get(g) ?? 1));
    return KANA_ONLY.test(g) && !nameGrams.has(g) ? idf * KANA_ONLY_WEIGHT : idf;
  };

  const lengths = chunks.map((c) => c.text.length);
  const averageLength = lengths.reduce((sum, n) => sum + n, 0) / chunks.length;
  const normalizedNames = new Set(names.map(normalizeText));

  return chunks
    .map((chunk, i) => {
      let score = 0;
      for (const g of queryGrams) {
        if (chunkGrams[i].body.has(g)) score += weight(g);
        if (chunkGrams[i].label.has(g)) score += weight(g);
      }
      score /= 1 - LENGTH_NORMALIZATION + (LENGTH_NORMALIZATION * lengths[i]) / averageLength;
      if (normalizedNames.has(normalizeText(chunk.label))) score *= NAME_LABEL_BONUS;
      return { chunk, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Reciprocal Rank Fusion の定数。上位の差をなだらかにする一般的な値
const RRF_K = 60;

/**
 * 複数の順位（bigram とベクトル）を Reciprocal Rank Fusion で1つにまとめる。
 * 点数の尺度が違う（IDF の和とコサイン類似度）ので、点数ではなく順位で混ぜる。
 */
export function fuseRankings(rankings: RankedChunk[][]): RankedChunk[] {
  const fused = new Map<string, RankedChunk>();
  for (const ranking of rankings) {
    ranking.forEach(({ chunk }, rank) => {
      const entry = fused.get(chunk.id) ?? { chunk, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      fused.set(chunk.id, entry);
    });
  }
  return Array.from(fused.values()).sort((a, b) => b.score - a.score);
}
