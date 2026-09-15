"use client";

import Link from "next/link";
import { formatTime } from "@/lib/client/format";
import type { RevealQuestion, Verdict } from "@/lib/server/reveal/types";
import { PILL_CLASS, VERDICT_LABEL, speakerName } from "./verdict";

// --- 予想フェーズ: 会話に出た話を本当か嘘か選ぶ ---

function GuessToggle({
  value,
  onChange,
  label,
}: {
  value: Verdict | undefined;
  onChange: (v: Verdict | undefined) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 overflow-hidden rounded-md border border-hairline bg-canvas">
      {(["true", "lie"] as const).map((v) => {
        const selected = value === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : v)}
            className={`min-w-[52px] px-sm py-xxs text-[13px] font-medium transition-colors ${
              selected ? PILL_CLASS[v] : "text-body hover:bg-surface-soft"
            } ${v === "lie" ? "border-l border-hairline" : ""}`}
          >
            {VERDICT_LABEL[v]}
          </button>
        );
      })}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  guess,
  onGuess,
}: {
  index: number;
  question: RevealQuestion;
  guess: Verdict | undefined;
  onGuess: (v: Verdict | undefined) => void;
}) {
  return (
    <li className="flex flex-col gap-sm rounded-lg border border-hairline bg-canvas px-sm py-sm sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-sm">
        <span className="mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-card text-[12px] font-medium text-muted">
          {index}
        </span>
        <div className="min-w-0">
          <p className="text-[12px] text-muted-soft">
            {speakerName(question.speaker)} ・ {formatTime(question.createdAt)}
          </p>
          <p className="mt-[2px] text-[15px] leading-[1.55] text-ink">「{question.text}」</p>
        </div>
      </div>
      <div className="self-end sm:self-center">
        <GuessToggle value={guess} onChange={onGuess} label={`${index}番の予想`} />
      </div>
    </li>
  );
}

export function GuessPhase({
  sessionId,
  questions,
  guesses,
  onGuess,
  onSubmit,
  submitting,
}: {
  sessionId: string;
  questions: RevealQuestion[];
  guesses: Record<string, Verdict>;
  onGuess: (id: string, v: Verdict | undefined) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const answered = questions.filter((q) => guesses[q.id]).length;

  return (
    <>
      <section className="mt-lg rounded-xl bg-surface-card px-md py-md">
        <h2 className="text-title-md font-medium text-ink">どれが嘘だったと思う？</h2>
        <p className="mt-xs text-[14px] leading-[1.6] text-body">
          会話に出てきた話を、本当か嘘か選んでください。迷ったものは選ばずに進めます。
        </p>
        <p className="mt-xs text-[13px] leading-[1.6] text-muted">
          答えを見ると、このチャットには続けて送信できなくなります。
        </p>
      </section>

      {questions.length === 0 ? (
        <section className="mt-md rounded-lg border border-dashed border-hairline px-md py-lg text-center">
          <p className="text-[14px] text-muted">この会話には、答え合わせできる設定の話がまだありません。</p>
          <Link
            href={`/chat/${sessionId}`}
            className="mt-sm inline-block rounded-md bg-primary px-sm py-xxs text-[13px] font-medium text-on-primary hover:bg-primary-active"
          >
            会話に戻る
          </Link>
        </section>
      ) : (
        <ol className="mt-md space-y-xs">
          {questions.map((q, i) => (
            <QuestionCard key={q.id} index={i + 1} question={q} guess={guesses[q.id]} onGuess={(v) => onGuess(q.id, v)} />
          ))}
        </ol>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-hairline bg-canvas/95 px-md py-sm backdrop-blur">
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-sm">
          <p className="text-[13px] text-muted">
            {questions.length > 0 ? `${questions.length}件中 ${answered}件 予想済み` : "会話を終えて、ふりかえることもできます"}
          </p>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="shrink-0 rounded-md bg-primary px-md py-xs text-[14px] font-medium text-on-primary transition-colors enabled:hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted-soft"
          >
            {submitting ? "読み込み中……" : answered > 0 || questions.length === 0 ? "答えを見る" : "予想しないで答えを見る"}
          </button>
        </div>
      </div>
    </>
  );
}
