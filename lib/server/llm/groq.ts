import { AllKeysRestingError, classifyKeyFailure } from "./key-pool";

/**
 * Gemini が使えないときの逃げ先（Groq）。
 *
 * 逃げるのは**キーの問題で Gemini が使えないとき**だけ:
 * - `GEMINI_API_KEY` が1本も入っていない
 * - 無料枠を使い切った（429）・キーが無効（401/403）で、2本とも休み中になった
 * - 混雑（503 UNAVAILABLE）で返らない（キーを変えても直らないので、提供元ごと替える）
 * それ以外の失敗（プロンプトやスキーマの誤りなど）は投げ直す。逃げ先でも同じように失敗するので、
 * 隠すと原因が分からなくなる。
 *
 * Groq は OpenAI 互換なので、`ai.models.generateContent` に渡している Gemini の形
 * （systemInstruction / responseSchema / maxOutputTokens）をここで OpenAI 互換の形に訳す。
 * 呼び出し側は `client.ts` の `ai` を今までどおり使うだけで、どちらに向いたかを知らない。
 *
 * **埋め込み（embedContent）は Groq に無いので逃がさない。** 埋め込みが失敗しても、段落の検索が
 * 文字 bigram だけになる（会話は止まらない）。
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
/** 会話が止まらない長さ。Gemini 側の待ちに足して長くなりすぎないようにする */
const GROQ_TIMEOUT_MS = 30_000;

/**
 * 出力トークンの上限。**Groq の無料枠は「1分あたりの出力トークン（OTPM）が 1,000」**で、
 * `max_completion_tokens` にそれより大きい数を書くだけで `429 Request too large` になる
 * （Gemini 側は 1024〜2048 を要求している）。ここで丸めて、その事故を防ぐ。
 */
const GROQ_MAX_OUTPUT_TOKENS = 900;
/** 1分の枠に当たったとき、これ以内の待ちなら1回だけ待って送り直す（長い待ちは会話が止まるので諦める） */
const GROQ_RETRY_AFTER_MAX_MS = 6_000;

/**
 * 逃げ先のモデルは呼び出し口ごとに分ける。**Groq の1分あたりのトークン（TPM 8,000）は
 * モデルごとに別の枠**なので、散らすほど1分の余裕が増える（実測: 120b を使い切っても 20b の
 * 残りは減らない）。ただし**1日あたりのリクエスト数（1,000回）はモデル共通**なので、
 * 散らしても1日の回数は増えない（1発話あたり3〜4回 = 1日およそ250発話）。
 *
 * 呼び出し側が `kind` で行き先を言う（Gemini 側のモデル名では、会話と資料係が同じモデルなので分けられない）。
 * このキーで使えて strict に応えられたのは `openai/gpt-oss-120b` / `openai/gpt-oss-20b` /
 * `qwen/qwen3.8-27b` の3つ（llama 系と minimax は 404、safeguard-20b は strict で 400）。
 *
 * | kind | 呼び出し口 | 既定 | 理由 |
 * |---|---|---|---|
 * | `chat` | シオリの返答 | `openai/gpt-oss-120b` | 口調と日本語の質がそのまま体験になる |
 * | `toshio` | としおの割り込み | `openai/gpt-oss-120b` | 同上。シオリと同じ枠だが、毎発話は呼ばない |
 * | `topic` | 資料係・作り手 | `qwen/qwen3.8-27b` | 入力が大きい（段落8件）ので枠を分ける |
 * | `extract` | 主張の取り出し | `qwen/qwen3.8-27b` | **20b では `400 Failed to validate JSON` になった** |
 * | `router` | 切り替わりの判定役 | `openai/gpt-oss-20b` | スキーマも文脈も小さい |
 *
 * **小さいモデルに資料係や取り出しを回さないこと**（大きいスキーマに応えられず 400 になる）。
 */
export type GroqKind = "chat" | "toshio" | "topic" | "extract" | "router";

const GROQ_MODEL_ENV: Record<GroqKind, { env: string; fallback: string }> = {
  chat: { env: "GROQ_MODEL", fallback: "openai/gpt-oss-120b" },
  toshio: { env: "GROQ_TOSHIO_MODEL", fallback: "openai/gpt-oss-120b" },
  topic: { env: "GROQ_TOPIC_MODEL", fallback: "qwen/qwen3.8-27b" },
  extract: { env: "GROQ_EXTRACT_MODEL", fallback: "qwen/qwen3.8-27b" },
  router: { env: "GROQ_ROUTER_MODEL", fallback: "openai/gpt-oss-20b" },
};

export function groqModel(kind: GroqKind = "chat"): string {
  const { env, fallback } = GROQ_MODEL_ENV[kind] ?? GROQ_MODEL_ENV.chat;
  return process.env[env]?.trim() || fallback;
}

/** Groq のキーがあるか。無ければ逃げ先は無い（今までどおり Gemini の失敗がそのまま出る）。 */
export function groqEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

/**
 * Gemini がキーの問題で使えなくなった失敗か（＝逃げてよいか）。
 * `classifyKeyFailure` が拾うのは 429（枠切れ）と 401/403（無効なキー）で、
 * 2本とも休みに入ったときは key-pool が `AllKeysRestingError` を投げる。
 * 混雑（503 UNAVAILABLE）はキーを変えても直らないので、ここで別に拾う。
 */
export function isGeminiUnusable(error: unknown): boolean {
  if (error instanceof AllKeysRestingError) return true;
  if (classifyKeyFailure(error, Date.now())) return true;
  const status = (error as { status?: unknown } | null)?.status;
  const raw = error instanceof Error ? error.message : String(error);
  if (status === 503 || status === 500) return true;
  return /"code":\s*50[03]|UNAVAILABLE/.test(raw);
}

/** Gemini の `Type.OBJECT` などの型名（大文字）を JSON Schema の型名に直す。 */
function jsonSchemaType(type: unknown): string {
  return String(type ?? "string").toLowerCase();
}

/**
 * Gemini の responseSchema を、Groq の `response_format.json_schema` に渡せる JSON Schema にする。
 * strict モード（スキーマどおりを保証する）には「全プロパティが required」「additionalProperties: false」が要る。
 * この app のスキーマはもともと全項目 required なので、ここで補って strict のまま通す。
 */
export function toJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "string" };
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = { type: jsonSchemaType(s.type) };
  if (Array.isArray(s.enum)) out.enum = [...s.enum];
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.properties && typeof s.properties === "object") {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s.properties as Record<string, unknown>)) {
      properties[key] = toJsonSchema(value);
    }
    out.properties = properties;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

type GeminiContent = { role?: string; parts?: ({ text?: string } | string)[] };

/** Gemini の contents（role / parts）を OpenAI 互換の messages にする。 */
export function toMessages(params: GeminiLikeParams): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];
  const system = params.config?.systemInstruction;
  if (typeof system === "string" && system.trim().length > 0) messages.push({ role: "system", content: system });

  const raw = params.contents;
  const contents: unknown[] = Array.isArray(raw) ? raw : [raw];
  for (const item of contents) {
    if (typeof item === "string") {
      messages.push({ role: "user", content: item });
      continue;
    }
    const content = (item ?? {}) as GeminiContent;
    const text = (content.parts ?? [])
      .map((p) => (typeof p === "string" ? p : (p?.text ?? "")))
      .join("")
      .trim();
    if (text.length === 0) continue;
    // Gemini の "model" は OpenAI 互換では "assistant"
    messages.push({ role: content.role === "model" ? "assistant" : "user", content: text });
  }
  return messages;
}

/** `ai.models.generateContent` に渡している形のうち、逃げ先でも要るものだけ。 */
export type GeminiLikeParams = {
  model: string;
  contents: unknown;
  config?: {
    systemInstruction?: unknown;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
    temperature?: number;
  };
};

/** 呼び出し側が読むのは `.text` だけ（client.ts の `ai` の返り値の形）。 */
export type TextResponse = { text?: string };

/** Groq に投げる本体（テストしやすいように、組み立てだけを純粋に切り出す）。 */
export function toGroqRequest(params: GeminiLikeParams, kind: GroqKind = "chat"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: groqModel(kind),
    messages: toMessages(params),
  };
  body.max_completion_tokens = Math.min(params.config?.maxOutputTokens ?? GROQ_MAX_OUTPUT_TOKENS, GROQ_MAX_OUTPUT_TOKENS);
  if (typeof params.config?.temperature === "number") body.temperature = params.config.temperature;
  if (params.config?.responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "response", strict: true, schema: toJsonSchema(params.config.responseSchema) },
    };
  } else if (params.config?.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

/**
 * Groq の chat completions を Gemini と同じ形（`{ text }`）で返す。
 * 失敗はそのまま投げる（呼び出し側は今までの Gemini の失敗と同じように扱う）。
 */
export async function groqGenerateContent(params: GeminiLikeParams, kind: GroqKind = "chat"): Promise<TextResponse> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY が未設定です");

  const payload = JSON.stringify(toGroqRequest(params, kind));
  const send = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    try {
      return await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: payload,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await send();
  // 1分の枠（TPM / OTPM）に当たったときは、短い待ちなら1回だけ送り直す
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get("retry-after"));
    if (wait !== null && wait <= GROQ_RETRY_AFTER_MAX_MS) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      response = await send();
    }
  }
  if (!response.ok) throw new Error(`[groq] HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = body?.choices?.[0]?.message?.content;
  return { text: typeof content === "string" ? content : undefined };
}

/** `retry-after`（秒。小数もある）を ms にする。読めなければ null */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}
