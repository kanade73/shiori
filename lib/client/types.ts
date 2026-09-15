import type { ResponseStrategy, Speaker } from "@/lib/server/types";

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

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}
