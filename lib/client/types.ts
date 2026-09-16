import type { ChatSession, ResponseStrategy, ShioriExpression, Speaker } from "@/lib/server/types";

export type ViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  strategy?: ResponseStrategy;
  /** role === "assistant" のときのみ意味を持つ。未設定は「シオリ」。 */
  speaker?: Speaker;
  /** シオリの発話の表情。message-start で届く。無ければ neutral */
  expression?: ShioriExpression;
};


/**
 * セッションの見出し。会話の最初に把握した話題の場面（issue #14）を出す。
 * 旧データ（シーン検索で視聴進捗を入れていたセッション）はその入力。話数は出さない。
 */
export function sessionLabel(session: Pick<ChatSession, "topic" | "progressDescription">): string {
  if (session.topic) return session.topic.title;
  if (session.progressDescription) return session.progressDescription;
  return "話題はこれから";
}
