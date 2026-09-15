import type { RevealData, RevealMessage, Verdict } from "@/lib/server/reveal/types";

/** 答え合わせ画面の各コンポーネントで共有する、真偽の表示ルール。 */

export type Revealed = Extract<RevealData, { status: "revealed" }>;

export const VERDICT_LABEL: Record<Verdict, string> = { true: "本当", lie: "嘘" };

export const MARK_CLASS: Record<Verdict, string> = {
  lie: "bg-[#c6435a1f] decoration-error",
  true: "bg-[#4caa771f] decoration-success",
};

export const PILL_CLASS: Record<Verdict, string> = {
  lie: "bg-error text-on-primary",
  true: "bg-success text-on-primary",
};

/** 予想と真偽の組み合わせ。予想しなかったものは null */
export function outcomeOf(verdict: Verdict, guess: Verdict | undefined): { label: string; good: boolean } | null {
  if (!guess) return null;
  if (verdict === "lie") return guess === "lie" ? { label: "見抜いた", good: true } : { label: "本当と予想", good: false };
  return guess === "true" ? { label: "正解", good: true } : { label: "嘘と予想", good: false };
}

export function speakerName(speaker: RevealMessage["speaker"]) {
  return speaker === "toshio" ? "としお" : "シオリ";
}
