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
 * 逃げ先のモデル。既定は `openai/gpt-oss-120b`（production 扱い・文脈 131K・
 * JSON schema の strict モードに対応）。`GROQ_MODEL` で差し替えられる。
 * Gemini 側はモデルを3つ（会話 / 取り出し / 判定役）使い分けているが、Groq の無料枠は
 * 組織ごと・モデルごと（30 req/分・14,400 req/日）で、キーを増やしても枠は増えないため、
 * ここでは分けずに1つにしている。
 */
export function groqModel(): string {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
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
export function toGroqRequest(params: GeminiLikeParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: groqModel(),
    messages: toMessages(params),
  };
  if (params.config?.maxOutputTokens) body.max_completion_tokens = params.config.maxOutputTokens;
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
export async function groqGenerateContent(params: GeminiLikeParams): Promise<TextResponse> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY が未設定です");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(toGroqRequest(params)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`[groq] HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body?.choices?.[0]?.message?.content;
    return { text: typeof content === "string" ? content : undefined };
  } finally {
    clearTimeout(timer);
  }
}
