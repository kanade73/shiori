import type { ChatSession, ResponseStrategy, Speaker } from "@/lib/server/types";

export type ViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  fabricatedFactIds?: string[];
  strategy?: ResponseStrategy;
  /** role === "assistant" のときのみ意味を持つ。未設定は「シオリ」。 */
  speaker?: Speaker;
};

/**
 * セッションの見出し。会話の最初に把握した話題の場面（issue #14）を出す。
 * 旧データ（シーン検索で視聴進捗を入れていたセッション）はその入力か話数。
 */
export function sessionLabel(session: Pick<ChatSession, "topic" | "progressDescription" | "currentEpisode">): string {
  if (session.topic) return session.topic.title;
  if (session.progressDescription) return session.progressDescription;
  if (session.currentEpisode > 0) return `第${session.currentEpisode}話まで`;
  return "話題はこれから";
}

/** 本物の設定がいつ明かされるか。0 は話数の分からない、話題の場面について外部の資料で確かめた設定 */
export function episodeFromLabel(episodeFrom: number): string {
  return episodeFrom > 0 ? `第${episodeFrom}話〜` : "今日の話題";
}
