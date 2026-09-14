import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, GENERATION_MODEL } from "./client";
import { UserMessageAnalysisSchema } from "./schemas";
import type { UserMessageAnalysis } from "../types";

const SYSTEM_PROMPT = `あなたはアニメ視聴者のチャット発言を解析するアシスタントです。
発言から、言及されているキャラクター名・出来事・感情の傾向・質問の種類を構造化して抽出してください。
キャラクター名や出来事が明示されていない場合は空配列にしてください。`;

export async function analyzeUserMessage(userMessage: string): Promise<UserMessageAnalysis> {
  const response = await anthropic.messages.parse({
    model: GENERATION_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: "low",
      format: zodOutputFormat(UserMessageAnalysisSchema),
    },
    messages: [{ role: "user", content: userMessage }],
  });

  if (!response.parsed_output) {
    return { mentionedCharacters: [], mentionedEvents: [], sentiment: "neutral", questionType: "other" };
  }
  return response.parsed_output;
}
