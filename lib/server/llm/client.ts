import { GoogleGenAI } from "@google/genai";

// The SDK is given ONLY the key from the environment - never an ambient
// credential - so nothing is sent unless someone has deliberately put
// GEMINI_API_KEY in .env.local (or the host's secrets). Without a key the
// request fails before anything useful happens and the pipeline falls back
// to a canned reply, which keeps the UI usable offline.
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const llmEnabled = Boolean(process.env.GEMINI_API_KEY);

// 無料枠で利用可能な高速モデル。GEMINI_MODEL で差し替え可能。
// gemini-2.5-flash は新規ユーザー向けに廃止済み（404 NOT_FOUND）のため gemini-3.6-flash を既定にする
export const GENERATION_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// 返答文から主張を取り出すだけの事務的な呼び出し（extract.ts）。会話の質は要らず
// 分類ができればよいので、既定では会話より軽いモデルを使う。将来ここをローカルの
// 軽量モデル（LoRA）に差し替える想定で、モデル名だけ別の環境変数にしてある。
export const EXTRACTION_MODEL = process.env.GEMINI_EXTRACT_MODEL || "gemini-3.5-flash-lite";

// 話題の切り替わりの判定役（issue #14 の続き）。文脈の小さい判定だけなので軽いモデルでよい。
// 無料枠の上限はモデルごと（flash-lite で1分15回）なので、シオリの generate（GEMINI_MODEL）とは
// 別のモデルにして枠を食い合わないようにする。GEMINI_MODEL と同じにすると、判定のある発話で
// シオリの分の枠を削る
export const ROUTER_MODEL = process.env.GEMINI_ROUTER_MODEL || "gemini-3.1-flash-lite";

// 外部資料の段落のベクトル検索用。gemini-embedding-001 は1リクエストで最大100件まとめて埋め込める
// （gemini-embedding-2 は複数入力を1本のベクトルに束ねるので、段落ごとの検索には使えない）
export const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
