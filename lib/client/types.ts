import type { ResponseStrategy } from "@/lib/server/types";

export type ViewMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  fabricatedFactIds?: string[];
  strategy?: ResponseStrategy;
};

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}
