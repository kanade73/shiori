import { Type } from "@google/genai";
import { ai, EXTRACTION_MODEL } from "./client";
import { ExtractedClaimSchema, ExtractedClaimsSchema } from "./schemas";
import { CLAIM_RELATIONS, normalizeText, type Normalizer } from "../claims";
import type { CanonFact, Claim, ClaimRelation } from "../types";

/**
 * シオリの返答文から「作品の設定に関する主張」を取り出す事務的な呼び出し。
 * 生成（generate.ts）から分けてあるのは、会話中のモデルに記録係を兼ねさせると
 * 自己監視に寄って嘘をやめるため。取り出した claims は evaluate（矛盾検査）と
 * FabricatedFact の保存、としおに渡す題材に使う。
 *
 * grounding（canon か fabricated か）は**モデルに出させない**。モデルが出すのは
 * 三つ組と抜き出しだけで、視聴済み範囲の canonFacts と照合して決めるのはコード
 * （`groundClaims`）の仕事。ここを LLM に任せると、作り話が canon 扱いになって
 * 嘘として保存されない取りこぼしが出る。
 *
 * 経路は3つで、環境変数で選ぶ（上から順に、設定のある最初のもの）:
 * - `EXTRACT_OLLAMA_MODEL` があれば Ollama（`OLLAMA_HOST`、既定 http://localhost:11434）の
 *   `/api/chat` に、ml/common.py と同じ指示（EXTRACT_PROMPT）を JSON schema 付きで投げる
 * - `EXTRACT_ENDPOINT` があれば自前の LoRA 推論サーバ（ml/serve.py）の `POST /extract`
 * - どちらも無ければ Gemini（`GEMINI_EXTRACT_MODEL`）に同じ指示を構造化出力で投げる
 * **選んだ経路が使えなくても別の経路には落とさない**（手元の推論を検証しているときに、
 * Gemini に落ちて「動いてしまう」と出来が測れないため）。その発話の claims は空になる
 * （返答文はそのまま返る）。
 */

/** モデル（Ollama / 推論サーバ / Gemini）が出す1件分。grounding はここには無い（コードが決める）。 */
export type ExtractedClaim = {
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim?: string;
  quote?: string;
};

/** どの実装で三つ組を取り出したか（開発者モードのパネルに1語出すだけ）。 */
export type ExtractBackend = "local" | "ollama" | "gemini";

/** 自前の推論サーバの待ち時間。デモ中に会話が止まらない長さに切る。 */
export const EXTRACT_TIMEOUT_MS = 10_000;
/**
 * Ollama の待ち時間。手元の CPU/GPU で 8B 級を回すと初回のモデル読み込みと
 * 数百トークンの生成で 10 秒を超えることがあるので、別枠で長めに取る。
 */
export const OLLAMA_TIMEOUT_MS = 60_000;

const CLOSED_RELATIONS = new Set<string>(
  CLAIM_RELATIONS.map((r) => normalizeText(r)),
);
const RELATION_VOCABULARY = new Set<string>(CLAIM_RELATIONS);

/**
 * モデルが返した JSON を `ExtractedClaim[]` にする。
 * 形が違えば例外（呼び出し側が claims 空に落とす）。
 * **1件ごとの不備は捨てるだけ**にしてあるのは、語彙外の relation を1件混ぜられた
 * だけで、その発話の主張を全部落とすのがもったいないため。
 */
export function parseExtractedClaims(payload: unknown): ExtractedClaim[] {
  const outer = ExtractedClaimsSchema.safeParse(payload);
  if (!outer.success) throw new Error("claims の形が違う");

  const claims: ExtractedClaim[] = [];
  for (const item of outer.data.claims) {
    const parsed = ExtractedClaimSchema.safeParse(item);
    if (!parsed.success) continue;
    const { relation } = parsed.data;
    // relation は閉じた語彙。外れたものは矛盾検査の対象にできないので捨てる
    if (!RELATION_VOCABULARY.has(relation)) continue;
    claims.push({
      subject: parsed.data.subject,
      relation: relation as ClaimRelation,
      object: parsed.data.object,
      negated: parsed.data.negated ?? false,
      claim: parsed.data.claim,
      quote: parsed.data.quote,
    });
  }
  return claims;
}

/**
 * object どうしの一致。canonFact の object は「ハムスターなどの齧歯類」のような
 * 句であることが多く、主張側は「ハムスター」のように一語で出る。完全一致だけを
 * 見ると本物の設定の言い直しまで嘘として保存されてしまうので、片方が他方を
 * 含んでいれば同じことを述べているとみなす。
 */
function objectMatches(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  if (a.length >= 2 && b.includes(a)) return true;
  if (b.length >= 2 && a.includes(b)) return true;
  return false;
}

/**
 * 主張が「本物の設定」のどれを述べたものかを探す。純粋関数。
 * 判定は正規化（entities の別名 → 正式名）した subject / relation / object の一致で行う。
 * canonFact の relation は自由記述なので、閉じた語彙で書かれているときだけ厳密に
 * 比べ、そうでなければ subject と object の一致をもって同じ事実とみなす。
 * 否定の主張（negated）は本物の設定の裏返しなので、一致しても canon にはしない。
 */
export function matchCanonFacts(
  claim: ExtractedClaim,
  canonFacts: CanonFact[],
  normalize: Normalizer,
): CanonFact[] {
  if (claim.negated) return [];
  const subject = normalize(claim.subject);
  const object = normalize(claim.object);
  if (subject.length === 0) return [];

  return canonFacts.filter((fact) => {
    if (normalize(fact.subject) !== subject) return false;
    if (!objectMatches(object, normalize(fact.object))) return false;
    const canonRelation = normalizeText(fact.relation);
    if (CLOSED_RELATIONS.has(canonRelation))
      return canonRelation === normalizeText(claim.relation);
    return true;
  });
}

/**
 * 取り出した三つ組に grounding を付ける。canonFacts に一致すれば canon、
 * しなければ fabricated。ここがコード側で決まっていることが、嘘が必ず
 * FabricatedFact として残ることの担保になっている。
 */
export function groundClaims(
  claims: ExtractedClaim[],
  canonFacts: CanonFact[],
  normalize: Normalizer,
): Claim[] {
  const grounded: Claim[] = [];
  for (const claim of claims) {
    if (claim.subject.trim().length === 0 || claim.object.trim().length === 0)
      continue;
    const matched = matchCanonFacts(claim, canonFacts, normalize);
    const sentence = (claim.claim ?? "").trim() || (claim.quote ?? "").trim();
    grounded.push({
      subject: claim.subject.trim(),
      relation: claim.relation,
      object: claim.object.trim(),
      negated: claim.negated,
      claim:
        sentence || `${claim.subject} / ${claim.relation} / ${claim.object}`,
      grounding: matched.length > 0 ? "canon" : "fabricated",
      sourceCanonFactIds: matched.map((f) => f.id),
      quote: claim.quote?.trim() || undefined,
    });
  }
  return grounded;
}

/** 推論サーバに渡す材料（canonFacts は渡さない）。 */
type ExtractInput = {
  /** シオリの返答文 */
  text: string;
  workTitle: string;
  /** 返答文だけでは主語が省略されて読めないことがあるので、文脈として渡す */
  userMessage?: string;
};

/** 自前の推論サーバの URL。未設定なら null（Ollama も無ければ Gemini を使う）。末尾の / は落とす。 */
export function extractEndpoint(): string | null {
  const raw = process.env.EXTRACT_ENDPOINT?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Ollama の設定。`EXTRACT_OLLAMA_MODEL`（例 qwen3:8b）が設定されていれば Ollama を使う。
 * ホストは `OLLAMA_HOST`（Ollama 本体と同じ変数名。既定 http://localhost:11434）。
 */
export function ollamaConfig(): { host: string; model: string } | null {
  const model = process.env.EXTRACT_OLLAMA_MODEL?.trim();
  if (!model) return null;
  const rawHost = process.env.OLLAMA_HOST?.trim() || "http://localhost:11434";
  const host = (
    /^https?:\/\//.test(rawHost) ? rawHost : `http://${rawHost}`
  ).replace(/\/+$/, "");
  return { host, model };
}

/**
 * 記録係への指示。ml/common.py の EXTRACT_PROMPT と同文（LoRA の学習データもこれで
 * 作ってある）。ここを変えるなら common.py も変える。
 */
export const EXTRACT_PROMPT = `あなたはアニメ考察チャットの返答文を読んで、内容を機械可読な形に書き起こす記録係です。
渡された「返答文」の中で述べられている、作品の設定に関する主張を**すべて**列挙してください。
感想・相槌・問いかけ・自分の気持ちは主張ではありません。設定に触れていなければ空配列で構いません。
記録漏れは後で矛盾を生むので、迷ったら入れてください。
返答文に書かれていないことを補ってはいけません。書かれている内容だけを分解します。

各主張は subject / relation / object / negated に分解します。
- subject と object はキャラクター名・場所・物などの名詞。呼び名は作品での正式な名前に揃える
- relation は次から選ぶ:
  is（性質・属性）, identity（正体・本名・種族）, origin（由来・元ネタ・モチーフ）, lives_in（住んでいる場所）,
  first_appeared（初登場の場面・時期）, has（所有）, likes, dislikes, fears, can, cannot,
  did（過去にした行為・出来事）, related_to（家族・師弟・因縁などの関係）, secret（隠している事実）, other
- negated は「〜ではない」「〜していない」のような否定の主張なら true
- claim は主張を一文にしたもの
- quote は、返答文の中でその主張を述べている部分の**一字一句そのままの抜き出し**。要約・言い換えはしない
一つの文に複数の設定が入っていたら、それぞれ別の主張にしてください。

出力は {"claims": [...]} の JSON のみ。説明文や \`\`\`json のような囲みは付けない。`;

/** ml/common.py の build_user_prompt と同じ組み立て。 */
export function buildExtractUserPrompt({
  text,
  workTitle,
  userMessage,
}: ExtractInput): string {
  const context = userMessage
    ? `\n# 直前のユーザーの発言（文脈。ここからは主張を取り出さない）\n${userMessage}\n`
    : "";
  return `# 作品\n${workTitle}\n${context}\n# 返答文\n${text}`;
}

/** Ollama の `format` に渡す JSON schema。relation は閉じた語彙に絞る。 */
const OLLAMA_CLAIMS_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject: { type: "string" },
          relation: { type: "string", enum: [...CLAIM_RELATIONS] },
          object: { type: "string" },
          negated: { type: "boolean" },
          claim: { type: "string" },
          quote: { type: "string" },
        },
        required: [
          "subject",
          "relation",
          "object",
          "negated",
          "claim",
          "quote",
        ],
      },
    },
  },
  required: ["claims"],
} as const;

/** Gemini の `responseSchema`（上の Ollama 用と同じ形を SDK の型で書いたもの）。 */
const GEMINI_CLAIMS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    claims: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          relation: { type: Type.STRING, enum: [...CLAIM_RELATIONS] },
          object: { type: Type.STRING },
          negated: { type: Type.BOOLEAN },
          claim: { type: Type.STRING },
          quote: { type: Type.STRING },
        },
        required: [
          "subject",
          "relation",
          "object",
          "negated",
          "claim",
          "quote",
        ],
      },
    },
  },
  required: ["claims"],
};

/**
 * モデルが返した文字列 → JSON。素の JSON を期待するが、\`\`\` 囲みや前後の文が
 * 付いていても最初の {...} を拾う（ml/common.py の parse_claims_json と同じ救済）。
 */
export function parseClaimsText(raw: string): unknown {
  const s = raw.replace(/^\s*\`\`\`(?:json)?\s*|\s*\`\`\`\s*$/gm, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("JSON が見つからない");
    return JSON.parse(s.slice(start, end + 1));
  }
}

/**
 * 自前の LoRA 推論サーバ（`EXTRACT_ENDPOINT`）。`POST /extract` に返答文を投げると
 * 三つ組が返る（ml/serve.py）。grounding は返らないので、この後 `groundClaims` で付ける。
 * 繋がらない・遅い・形が違うときは例外にして、呼び出し側が claims 空に落とす。
 */
async function extractViaHttp(
  endpoint: string,
  { text, workTitle, userMessage }: ExtractInput,
): Promise<ExtractedClaim[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        workTitle,
        userMessage: userMessage ?? null,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseExtractedClaims(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ollama の `/api/chat`。`format` に JSON schema を渡して構造化出力にし、
 * qwen3 系の思考は `think: false` で切る（思考込みだと数十秒かかる）。
 * temperature 0 で決定的に。返答は `message.content` に JSON 文字列で入る。
 */
async function extractViaOllama(
  { host, model }: { host: string; model: string },
  input: ExtractInput,
): Promise<ExtractedClaim[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: OLLAMA_CLAIMS_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: buildExtractUserPrompt(input) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { message?: { content?: unknown } };
    const content = body?.message?.content;
    if (typeof content !== "string") throw new Error("message.content が無い");
    return parseExtractedClaims(parseClaimsText(content));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gemini（手元の推論を何も設定していないとき）。Ollama と同じ指示文・同じ入力を、
 * 構造化出力で投げる。キーが無い・上限に達した・形が違うときは例外にして、
 * 呼び出し側が claims 空に落とす。
 */
async function extractViaGemini(
  input: ExtractInput,
): Promise<ExtractedClaim[]> {
  const response = await withUnavailableRetry(() =>
    ai.models.generateContent({
      model: EXTRACTION_MODEL,
      contents: [
        { role: "user", parts: [{ text: buildExtractUserPrompt(input) }] },
      ],
      config: {
        systemInstruction: EXTRACT_PROMPT,
        responseMimeType: "application/json",
        responseSchema: GEMINI_CLAIMS_SCHEMA,
        maxOutputTokens: 2048,
      },
    }),
  );
  return parseExtractedClaims(parseClaimsText(response.text || "{}"));
}

/**
 * 混雑（503 UNAVAILABLE）のときだけ、短く待って同じリクエストを送り直す回数と間隔。
 * 取り出しはシオリの返答を流し切った後に走るので、数秒待っても表示は遅れない。
 * これが無いと、混雑のたびにその発話の claims が空になり、ついた嘘が1件も記録されない
 * （答え合わせで嘘が消え、以後の矛盾検査からも抜ける）。
 * 429 や無効なキーはキーの切り替え（key-pool）の領分なので、ここでは触らない。
 */
export const GEMINI_UNAVAILABLE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function isUnavailable(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 503;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withUnavailableRetry<T>(
  send: () => Promise<T>,
  delays: readonly number[] = GEMINI_UNAVAILABLE_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (!isUnavailable(error) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

type ExtractRoute =
  | { backend: "ollama"; ollama: { host: string; model: string } }
  | { backend: "local"; endpoint: string }
  | { backend: "gemini" };

/** 環境変数から取り出しの経路を1つ選ぶ（Ollama → 自前の推論サーバ → Gemini）。 */
export function extractRoute(): ExtractRoute {
  const ollama = ollamaConfig();
  if (ollama) return { backend: "ollama", ollama };
  const endpoint = extractEndpoint();
  if (endpoint) return { backend: "local", endpoint };
  return { backend: "gemini" };
}

function describeRoute(route: ExtractRoute): string {
  switch (route.backend) {
    case "ollama":
      return `Ollama ${route.ollama.host} / ${route.ollama.model}`;
    case "local":
      return `抽出サーバ ${route.endpoint}`;
    case "gemini":
      return `Gemini ${EXTRACTION_MODEL}`;
  }
}

function extractVia(
  route: ExtractRoute,
  input: ExtractInput,
): Promise<ExtractedClaim[]> {
  switch (route.backend) {
    case "ollama":
      return extractViaOllama(route.ollama, input);
    case "local":
      return extractViaHttp(route.endpoint, input);
    case "gemini":
      return extractViaGemini(input);
  }
}

export type ExtractResult = {
  claims: Claim[];
  /** 取り出しに使った側（ollama / local: LoRA 推論サーバ / gemini） */
  backend: ExtractBackend;
  /** 推論が使えず claims を取り出せなかった（パネルに「取り出せず」と出す） */
  failed?: boolean;
};

/**
 * 返答文 → Claim[]。pipeline はこの関数だけに依存する。
 * canonFacts は grounding の照合にだけ使い、プロンプトには載せない
 * （記録係に本物の設定を見せると、返答文に無いことを補い始める）。
 *
 * 推論が落ちていても会話は止めない。warn を1行出して claims 空を返すだけで、
 * その発話の嘘が保存されないという結果になる。
 */
export async function extractClaims(params: {
  /** シオリの返答文 */
  text: string;
  workTitle: string;
  /** 視聴済み範囲の本物の設定。grounding をコードで決めるための照合先 */
  canonFacts: CanonFact[];
  normalize: Normalizer;
  /** 返答文だけでは主語が省略されて読めないことがあるので、文脈として渡す */
  userMessage?: string;
}): Promise<ExtractResult> {
  const { text, workTitle, canonFacts, normalize, userMessage } = params;
  const route = extractRoute();
  const { backend } = route;
  if (text.trim().length === 0) return { claims: [], backend };

  try {
    const extracted = await extractVia(route, { text, workTitle, userMessage });
    return { claims: groundClaims(extracted, canonFacts, normalize), backend };
  } catch (error) {
    console.warn(
      `claims を取り出せませんでした（${describeRoute(route)}）: ${String(error)}`,
    );
    return { claims: [], backend, failed: true };
  }
}
