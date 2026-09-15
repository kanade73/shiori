import { GoogleGenAI } from "@google/genai";
import { createKeyRotation, fingerprint, newKeyRotationState, type KeyRotationState } from "./key-pool";

// The SDK is given ONLY keys from the environment - never an ambient
// credential - so nothing is sent unless someone has deliberately put
// GEMINI_API_KEY in .env.local (or the host's secrets). Without a key the
// request fails before anything useful happens and the pipeline falls back
// to a canned reply, which keeps the UI usable offline.
//
// キーは2本まで（issue #11）。GEMINI_API_KEY（自分）と GEMINI_API_KEY_2（先輩・省略可）。
// 無料枠の上限（429）に達したらもう1本に切り替え、そちらも尽きたら元に戻る（key-pool.ts）。
// 2本のキーは別のアカウント（= 別の Google Cloud プロジェクト）で作ったものでないと、枠を共有して意味がない
const KEY_ENV_NAMES = ["GEMINI_API_KEY", "GEMINI_API_KEY_2"] as const;

const configured = KEY_ENV_NAMES.flatMap((name) => {
  const key = process.env[name];
  return key ? [{ name, key }] : [];
});

const keys = (configured.length > 0 ? configured : [{ name: "GEMINI_API_KEY", key: "" }]).map(({ name, key }) => ({
  label: name,
  id: fingerprint(key),
  // httpOptions.retryOptions は付けない。付けると SDK が 429 を指数バックオフで待ってから投げ、切り替えが遅れる
  client: new GoogleGenAI({ apiKey: key }),
}));

export const llmEnabled = configured.length > 0;

// どのキーを使っているか・休ませているかは、ルートごとにモジュールが別に読まれても共有する
const shared = globalThis as typeof globalThis & { __geminiKeyRotation?: KeyRotationState };
const withApiKey = createKeyRotation(keys, { state: (shared.__geminiKeyRotation ??= newKeyRotationState()) });

type Models = GoogleGenAI["models"];

// 呼び出し側は SDK と同じ形（ai.models.generateContent / embedContent）で使う。中でキーを選んで送る
export const ai = {
  models: {
    generateContent: (params: Parameters<Models["generateContent"]>[0]) =>
      withApiKey(params.model, (client) => client.models.generateContent(params)),
    embedContent: (params: Parameters<Models["embedContent"]>[0]) =>
      withApiKey(params.model, (client) => client.models.embedContent(params)),
  },
};

// 無料枠で使える軽いモデル（issue #11 で決定）。GEMINI_MODEL で差し替え可能。
// gemini-3.6-flash は無料枠が1日20リクエストほどで、開発中にすぐ尽きる
export const GENERATION_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// 話題の切り替わりの判定役（issue #14 の続き）。文脈の小さい判定だけなので軽いモデルでよい。
// 無料枠の上限はモデルごと（flash-lite で1分15回）なので、シオリの generate（GEMINI_MODEL）とは
// 別のモデルにして枠を食い合わないようにする。GEMINI_MODEL と同じにすると、判定のある発話で
// シオリの分の枠を削る
export const ROUTER_MODEL = process.env.GEMINI_ROUTER_MODEL || "gemini-3.1-flash-lite";

// 外部資料のベクトル検索用。gemini-embedding-001 は1リクエストで最大100件まとめて埋め込める
// （gemini-embedding-2 は複数入力を1本のベクトルに束ねるので、段落ごとの検索には使えない）
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
