import { GoogleGenAI } from "@google/genai";

// GEMINI_API_KEY を環境変数から読み込む
export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

// 無料枠で利用可能な高速モデル
// gemini-2.5-flash は新規ユーザー向けに廃止済み（404 NOT_FOUND）のため gemini-3.6-flash を使用
export const GENERATION_MODEL = "gemini-3.6-flash";
