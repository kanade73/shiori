import type { SessionTopic } from "../types";

/** シオリ・としおのプロンプトに共通で入れる「今日の話題」（issue #14）。 */
export function formatTopic(topic: SessionTopic | null | undefined): string {
  if (!topic) return "（まだ決まっていない）";
  return `${topic.title}：${topic.summary}
（ユーザーが会話の最初に「話したい」と言った場面。本物の設定のうち [topic-…] は、この場面について外部の資料で確かめたもの）`;
}

/** ネタバレ境界の説明。話題の場面が arc に対応しないうちは話数が分からない */
export function formatViewing(currentEpisode: number): string {
  return currentEpisode > 0
    ? `ユーザーは少なくとも第${currentEpisode}話まで視聴済み`
    : "ユーザーがどこまで見たかは分からない。今日の話題の場面より先の展開には触れないこと";
}

export function formatEpisodeFrom(episodeFrom: number): string {
  return episodeFrom > 0 ? `(${episodeFrom}話〜) ` : "";
}
