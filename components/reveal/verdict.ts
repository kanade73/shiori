import type { RevealData, RevealMessage, Verdict } from "@/lib/server/reveal/types";

/** 答え合わせ画面の各コンポーネントで共有する、真偽の表示ルール。 */

export type Revealed = Extract<RevealData, { status: "revealed" }>;

export const MARK_CLASS: Record<Verdict, string> = {
  lie: "bg-[#c6435a1f] decoration-error",
  true: "bg-[#4caa771f] decoration-success",
};

export function speakerName(speaker: RevealMessage["speaker"]) {
  return speaker === "toshio" ? "としお" : "シオリ";
}
