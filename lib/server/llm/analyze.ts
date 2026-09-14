import { Type } from "@google/genai";
import { ai, GENERATION_MODEL } from "./client";
import { UserMessageAnalysisSchema } from "./schemas";
import type { UserMessageAnalysis } from "../types";

const SYSTEM_PROMPT = `あなたはアニメ視聴者のチャット発言を解析するアシスタントです。
発言から、言及されているキャラクター名・出来事・感情の傾向・質問の種類を構造化して抽出してください。
キャラクター名や出来事が明示されていない場合は空配列にしてください。`;

const analysisResponseSchema = {
  type: Type.OBJECT,
  properties: {
    mentionedCharacters: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    mentionedEvents: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    sentiment: {
      type: Type.STRING,
    },
    questionType: {
      type: Type.STRING,
      enum: ["impression", "memory_check", "theory", "fact_question", "other"],
    },
  },
  required: ["mentionedCharacters", "mentionedEvents", "sentiment", "questionType"],
};

export async function analyzeUserMessage(userMessage: string): Promise<UserMessageAnalysis> {
  try {
    const response = await ai.models.generateContent({
      model: GENERATION_MODEL,
      contents: userMessage,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: analysisResponseSchema,
      },
    });

    const text = response.text || "{}";
    const parsed = JSON.parse(text);
    return UserMessageAnalysisSchema.parse(parsed);
  } catch (error) {
    console.error("Failed to analyze user message with Gemini:", error);
    return {
      mentionedCharacters: [],
      mentionedEvents: [],
      sentiment: "neutral",
      questionType: "other",
    };
  }
}
