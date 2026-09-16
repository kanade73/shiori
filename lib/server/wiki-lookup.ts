import { normalizeText } from "./claims";

/**
 * 見知らぬ固有名詞がどの作品のものかを Wikipedia の検索で決める（issue #1 ナックルベンチ）。
 * LLM は使わない。キー不要・無料の MediaWiki API を1語につき1回叩き、上位の記事の
 * 「記事名」と「冒頭の1文」を決定的な規則で読む。有名な作品が拾えれば十分で、
 * マイナーな作品・新作まで対応し切る気はない（ユーザー判断。ハッカソンのデモ用）。
 *
 * 規則（優先順）:
 *   A. 記事名が「〇〇の登場人物」                       → 〇〇（一覧記事。単独の記事が無い脇役はここで拾う）
 *   B. 冒頭文に「『〇〇』に登場する／の登場人物／の主人公」「〇〇シリーズに登場する」 → 〇〇（人物・組織の記事）
 *   C. 冒頭文が「『〇〇』は、…による日本の漫画／アニメ／ゲーム／小説」で始まる → 〇〇（作品そのものの記事。
 *      「炭治郎」で検索すると『鬼滅の刃』の記事が上に来る）
 * いま話している作品と同じ名前に解けたら「別の作品」ではない。
 */

export const WIKIPEDIA_ENDPOINT = "https://ja.wikipedia.org/w/api.php";
const USER_AGENT = "misdirection-chat/0.1 (hackathon app; checks whether a name belongs to another work)";
const FETCH_TIMEOUT_MS = 6000;
/** 検索の上位いくつを読むか。一覧記事（〇〇の登場人物）は上位に来ないことがあるので少し多めに */
const SEARCH_LIMIT = 8;
/** 規則 C（作品そのものの記事）を読むのは、曖昧さ回避を除いた上位ここまで */
const WORK_ARTICLE_MAX_RANK = 3;

export type WikiPage = { title: string; extract: string };

const LIST_ARTICLE = /^(.+?)の登場(?:人物|キャラクター)/;
const APPEARS_IN = /(?:『([^』]+)』|([^、。「」『』（）()\s]+?)シリーズ)(?:[^。]{0,40}?)(?:に登場する|の登場人物|の主人公|に登場した)/;
const WORK_ARTICLE = /^『([^』]+)』(?:（[^）]*）|\([^)]*\))?\s*は、[^。]*?(漫画|アニメ|ゲーム|小説|ライトノベル|特撮)/;

function cleanTitle(title: string): string {
  return title.replace(/\s*[（(][^）)]*[）)]\s*$/, "").trim();
}

function sameWork(a: string, b: string): boolean {
  const x = normalizeText(a);
  const y = normalizeText(b);
  return x.length > 0 && y.length > 0 && (x === y || x.includes(y) || y.includes(x));
}

/** 曖昧さ回避のページ（「以下のいずれかを指す」・「語 - 説明」の列挙）。どの項目の話か決められないので読まない */
const DISAMBIGUATION = /以下の(いずれか|項目|通り)|^\S+\s+\S+ - /;

export type ResolvedWork = { work: string; rule: "list" | "appears_in" | "work_article" };

/** 検索結果（順位順）から、規則 A → B → C の優先で作品名を1つ決める。決まらなければ null */
export function resolveWorkFromPages(pages: WikiPage[], currentWorkTitle: string): ResolvedWork | null {
  const readable = pages.filter((p) => !DISAMBIGUATION.test(p.extract));
  const rules: { rule: ResolvedWork["rule"]; match: (p: WikiPage) => string | null }[] = [
    { rule: "list", match: (p) => p.title.match(LIST_ARTICLE)?.[1] ?? null },
    {
      rule: "appears_in",
      match: (p) => {
        const m = p.extract.match(APPEARS_IN);
        return m ? (m[1] ?? m[2]) : null;
      },
    },
    // 作品そのものの記事は、上位に来たときだけ読む。下位まで読むと、語を本文に含むだけの無関係な
    // 漫画・アニメの記事（「ボロボロ」→ 昔の短編映画）が拾われる
    {
      rule: "work_article",
      match: (p) => (WORK_ARTICLE.test(p.extract) && readable.indexOf(p) < WORK_ARTICLE_MAX_RANK ? cleanTitle(p.title) : null),
    },
  ];
  for (const { rule, match } of rules) {
    for (const page of readable) {
      const work = match(page)?.trim();
      if (!work) continue;
      // いまの作品（ちいかわの脇役を検索すると『ちいかわ』の記事が返る）は別の作品ではない
      if (sameWork(work, currentWorkTitle)) return null;
      return { work, rule };
    }
  }
  return null;
}

const RULE_PRIORITY: Record<ResolvedWork["rule"], number> = { list: 0, appears_in: 1, work_article: 2 };

/**
 * 複数の語がそれぞれ解けた作品から1つ選ぶ。票の多い作品、同数なら強い規則で解けた方、それも同じなら先の語。
 * 「ナックルとユピー」で、ナックルが『帰ってきたウルトラマン』（ナックル星人）、ユピーが『HUNTER×HUNTER』
 * （一覧記事）に解けたら HUNTER×HUNTER を採る。
 */
export function pickWork(resolved: (ResolvedWork | null)[]): ResolvedWork | null {
  const votes = new Map<string, { count: number; best: ResolvedWork; order: number }>();
  resolved.forEach((r, i) => {
    if (!r) return;
    const key = normalizeText(r.work);
    const v = votes.get(key);
    if (!v) votes.set(key, { count: 1, best: r, order: i });
    else {
      v.count += 1;
      if (RULE_PRIORITY[r.rule] < RULE_PRIORITY[v.best.rule]) v.best = r;
    }
  });
  const ranked = [...votes.values()].sort(
    (a, b) => b.count - a.count || RULE_PRIORITY[a.best.rule] - RULE_PRIORITY[b.best.rule] || a.order - b.order,
  );
  return ranked[0]?.best ?? null;
}

// 同じ語を何度も引かない（同じセッションで同じ名前が繰り返し出る）。Wikipedia は連続で叩くと 429 を返す
const cache = new Map<string, ResolvedWork | null>();

/** テスト用 */
export function clearWikiLookupCache() {
  cache.clear();
}

/** 語で Wikipedia を全文検索し、上位の記事名と冒頭1文を順位順に返す */
export async function searchWikipedia(word: string, endpoint: string = WIKIPEDIA_ENDPOINT): Promise<WikiPage[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: word,
    gsrlimit: String(SEARCH_LIMIT),
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exsentences: "1",
    exlimit: String(SEARCH_LIMIT),
  });
  const res = await fetch(`${endpoint}?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia search "${word}": HTTP ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: { title: string; extract?: string; index?: number }[] } };
  return (json.query?.pages ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title, extract: p.extract ?? "" }));
}

/** 語がどの作品のものか。Wikipedia で決まらなければ null。失敗も null */
export async function lookupWorkOfName(word: string, currentWorkTitle: string): Promise<ResolvedWork | null> {
  const key = `${normalizeText(currentWorkTitle)}|${normalizeText(word)}`;
  if (cache.has(key)) return cache.get(key)!;
  try {
    const result = resolveWorkFromPages(await searchWikipedia(word), currentWorkTitle);
    cache.set(key, result);
    return result;
  } catch (error) {
    console.warn(`Wikipedia の検索に失敗（「${word}」は本作の語として扱う）:`, error);
    return null;
  }
}
