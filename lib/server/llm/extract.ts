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
 * **このブランチの取り出しは自前の LoRA 推論サーバ（`EXTRACT_ENDPOINT`）専用**。
 * Gemini 版は削除してあり、フォールバックも持たない。LoRA の出来をそのまま見る
 * ための検証用ブランチなので、Gemini に落ちて「動いてしまう」道を塞いである。
 * サーバが使えなければその発話の claims は空（返答文はそのまま返る）。
 */

/** 推論サーバが出す1件分。grounding はここには無い（コードが決める）。 */
export type ExtractedClaim = {
  subject: string;
  relation: ClaimRelation;
  object: string;
  negated: boolean;
  claim?: string;
  quote?: string;
};

/**
 * どの実装で三つ組を取り出したか（開発者モードのパネルに1語出すだけ）。
 * このブランチでは local しかないが、イベントの型は他ブランチと揃えて残してある。
 */
export type ExtractBackend = "local";

/** 自前の推論サーバの待ち時間。デモ中に会話が止まらない長さに切る。 */
export const EXTRACT_TIMEOUT_MS = 10_000;

const CLOSED_RELATIONS = new Set<string>(CLAIM_RELATIONS.map((r) => normalizeText(r)));
const RELATION_VOCABULARY = new Set<string>(CLAIM_RELATIONS);

/**
 * 推論サーバが返した JSON を `ExtractedClaim[]` にする。
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
export function matchCanonFacts(claim: ExtractedClaim, canonFacts: CanonFact[], normalize: Normalizer): CanonFact[] {
  if (claim.negated) return [];
  const subject = normalize(claim.subject);
  const object = normalize(claim.object);
  if (subject.length === 0) return [];

  return canonFacts.filter((fact) => {
    if (normalize(fact.subject) !== subject) return false;
    if (!objectMatches(object, normalize(fact.object))) return false;
    const canonRelation = normalizeText(fact.relation);
    if (CLOSED_RELATIONS.has(canonRelation)) return canonRelation === normalizeText(claim.relation);
    return true;
  });
}

/**
 * 取り出した三つ組に grounding を付ける。canonFacts に一致すれば canon、
 * しなければ fabricated。ここがコード側で決まっていることが、嘘が必ず
 * FabricatedFact として残ることの担保になっている。
 */
export function groundClaims(claims: ExtractedClaim[], canonFacts: CanonFact[], normalize: Normalizer): Claim[] {
  const grounded: Claim[] = [];
  for (const claim of claims) {
    if (claim.subject.trim().length === 0 || claim.object.trim().length === 0) continue;
    const matched = matchCanonFacts(claim, canonFacts, normalize);
    const sentence = (claim.claim ?? "").trim() || (claim.quote ?? "").trim();
    grounded.push({
      subject: claim.subject.trim(),
      relation: claim.relation,
      object: claim.object.trim(),
      negated: claim.negated,
      claim: sentence || `${claim.subject} / ${claim.relation} / ${claim.object}`,
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

/**
 * 自前の推論サーバの URL。末尾の / は落とす。
 * **必須**。未設定は設定漏れなので、黙って別の経路に逃げず呼び出し時に例外にする
 * （起動時に落とさないのは、抽出を使わない画面まで開けなくなるのを避けるため）。
 */
export function extractEndpoint(): string {
  const raw = process.env.EXTRACT_ENDPOINT?.trim();
  if (!raw) {
    throw new Error("EXTRACT_ENDPOINT が未設定です。このブランチの claims 抽出はローカルの推論サーバ専用で、Gemini へのフォールバックはありません");
  }
  return raw.replace(/\/+$/, "");
}

/**
 * 自前の LoRA 推論サーバ（`EXTRACT_ENDPOINT`）。`POST /extract` に返答文を投げると
 * 三つ組が返る（ml/serve.py）。grounding は返らないので、この後 `groundClaims` で付ける。
 * 繋がらない・遅い・形が違うときは例外にして、呼び出し側が claims 空に落とす。
 */
async function extractViaHttp(endpoint: string, { text, workTitle, userMessage }: ExtractInput): Promise<ExtractedClaim[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, workTitle, userMessage: userMessage ?? null }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseExtractedClaims(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export type ExtractResult = {
  claims: Claim[];
  /** 取り出しに使った側。このブランチは常に local */
  backend: ExtractBackend;
  /** 推論サーバが使えず claims を取り出せなかった（パネルに「取り出せず」と出す） */
  failed?: boolean;
};

/**
 * 返答文 → Claim[]。pipeline はこの関数だけに依存する。
 * canonFacts は grounding の照合にだけ使い、プロンプトには載せない
 * （記録係に本物の設定を見せると、返答文に無いことを補い始める）。
 *
 * 推論サーバが落ちていても会話は止めない。warn を1行出して claims 空を返すだけで、
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
  // 設定漏れは例外（pipeline が claims 空として握るが、ログには明示的に出る）
  const endpoint = extractEndpoint();
  if (text.trim().length === 0) return { claims: [], backend: "local" };

  try {
    const extracted = await extractViaHttp(endpoint, { text, workTitle, userMessage });
    return { claims: groundClaims(extracted, canonFacts, normalize), backend: "local" };
  } catch (error) {
    console.warn(`claims 抽出サーバ（${endpoint}）から取り出せませんでした: ${String(error)}`);
    return { claims: [], backend: "local", failed: true };
  }
}
