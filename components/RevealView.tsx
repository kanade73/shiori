"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Mascot } from "./Mascot";
import { RevealGraph, statementAnchorId, toshioAnchorId } from "./RevealGraph";
import { getReveal, getSessionData, submitReveal } from "@/lib/client/api";
import { formatTime } from "@/lib/client/types";
import type {
  ChatSession,
  RevealData,
  RevealMessage,
  RevealQuestion,
  RevealStatement,
  Verdict,
  Work,
} from "@/lib/server/types";

type Revealed = Extract<RevealData, { status: "revealed" }>;

const VERDICT_LABEL: Record<Verdict, string> = { true: "本当", lie: "嘘" };

const MARK_CLASS: Record<Verdict, string> = {
  lie: "bg-[#c6435a1f] decoration-error",
  true: "bg-[#4caa771f] decoration-success",
};

const PILL_CLASS: Record<Verdict, string> = {
  lie: "bg-error text-on-primary",
  true: "bg-success text-on-primary",
};

/** 予想と真偽の組み合わせ。予想しなかったものは null */
function outcomeOf(verdict: Verdict, guess: Verdict | undefined): { label: string; good: boolean } | null {
  if (!guess) return null;
  if (verdict === "lie") return guess === "lie" ? { label: "見抜いた", good: true } : { label: "本当と予想", good: false };
  return guess === "true" ? { label: "正解", good: true } : { label: "嘘と予想", good: false };
}

function speakerName(speaker: RevealMessage["speaker"]) {
  return speaker === "toshio" ? "としお" : "シオリ";
}

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh bg-canvas px-md pb-section pt-lg">
      <div className={`mx-auto ${wide ? "max-w-[800px]" : "max-w-[760px]"}`}>{children}</div>
    </div>
  );
}

// --- 予想フェーズ ---

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

function GuessPhase({
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

// --- 結果フェーズ ---

function ResultSummary({ data }: { data: Revealed }) {
  const answered = data.statements.filter((s) => data.reveal.guesses[s.id]);
  const correct = answered.filter((s) => data.reveal.guesses[s.id] === s.verdict).length;
  const lies = data.statements.filter((s) => s.verdict === "lie").length;
  return (
    <section className="mt-xl border-y border-hairline py-lg">
      <div className="flex flex-wrap items-end justify-between gap-lg">
        <div>
          <h2 className="text-[14px] text-muted">会話に混ざっていた嘘</h2>
          <p className="mt-xs text-ink">
            <span className="font-display text-[40px] font-medium leading-none tabular-nums">{lies}</span>
            <span className="ml-xs text-[14px]">件</span>
            <span className="ml-sm text-[13px] text-muted">／ 確認できる話 {data.statements.length}件</span>
          </p>
        </div>
        {answered.length > 0 && (
          <p className="text-[14px] text-body">あなたの予想は <strong className="font-medium text-primary">{answered.length}件中 {correct}件正解</strong></p>
        )}
      </div>
      {data.statements.length === 0 && <p className="mt-sm text-[14px] text-muted">答え合わせできる話は記録されていません。</p>}
    </section>
  );
}

function Legend({ hasUntrackedMessages }: { hasUntrackedMessages: boolean }) {
  return (
    <div className="space-y-xxs text-[12px] text-muted">
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
        <span>
          <mark className={`rounded-[3px] px-[3px] text-ink underline decoration-2 underline-offset-4 ${MARK_CLASS.lie}`}>
            嘘
          </mark>
          <span className="ml-xxs">シオリの作り話</span>
        </span>
        <span>
          <mark className={`rounded-[3px] px-[3px] text-ink underline decoration-2 underline-offset-4 ${MARK_CLASS.true}`}>
            本当
          </mark>
          <span className="ml-xxs">本物の設定</span>
        </span>
        <span>印のない部分は、真偽を判定していません</span>
      </div>
      {hasUntrackedMessages && <p>※ 記録を始める前のシオリの発話は、嘘だけを本文の位置なしで示しています。</p>}
    </div>
  );
}

function MessageBody({
  message,
  statementsById,
  numberOf,
}: {
  message: RevealMessage;
  statementsById: Map<string, RevealStatement>;
  numberOf: Map<string, number>;
}) {
  return (
    <p className="mt-xxs whitespace-pre-wrap text-[15px] leading-[1.75] text-body">
      {message.segments.map((seg, i) => {
        const st = seg.statementId ? statementsById.get(seg.statementId) : undefined;
        if (!st) return <span key={i}>{seg.text}</span>;
        return (
          <mark
            key={i}
            className={`rounded-[3px] px-[2px] text-ink underline decoration-2 underline-offset-4 [box-decoration-break:clone] ${MARK_CLASS[st.verdict]}`}
          >
            {seg.text}
            <sup className={`ml-[2px] text-[10px] font-medium ${st.verdict === "lie" ? "text-error" : "text-success"}`}>
              {numberOf.get(st.id)}
            </sup>
          </mark>
        );
      })}
    </p>
  );
}

function StatementRow({
  statement,
  number,
  guess,
  located,
}: {
  statement: RevealStatement;
  number: number;
  guess: Verdict | undefined;
  located: boolean;
}) {
  const outcome = outcomeOf(statement.verdict, guess);
  const sources = statement.sources.map((s) => `第${s.episodeFrom}話〜 ${s.description}`).join(" / ");

  return (
    <li
      id={statementAnchorId(statement.id)}
      className="flex gap-sm border-b border-hairline py-lg scroll-mt-lg target:bg-surface-soft"
    >
      <span className="w-4 shrink-0 pt-[2px] text-right text-[11px] font-medium text-muted">{number}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-xs">
          <span className={`rounded-pill px-xs py-[1px] text-[11px] font-medium ${PILL_CLASS[statement.verdict]}`}>
            {VERDICT_LABEL[statement.verdict]}
          </span>
          <span className="w-full text-[15px] leading-[1.8] text-ink">{statement.quote ?? statement.claim}</span>
          {outcome && (
            <span
              className={`rounded-pill border px-xs py-[1px] text-[11px] ${
                outcome.good ? "border-primary text-primary" : "border-muted-soft text-muted"
              }`}
            >
              {outcome.label}
            </span>
          )}
        </div>
        <p className="mt-[2px] text-[12px] leading-[1.5] text-muted">
          {statement.verdict === "true"
            ? sources
              ? `根拠: ${sources}`
              : "根拠の設定は記録されていません"
            : sources
              ? `元にした本物の設定: ${sources}`
              : "この会話で作られた設定です。"}
          {!located && " ・ 本文中の位置は特定できませんでした"}
        </p>
      </div>
    </li>
  );
}

function ToshioNote({ message, numberOf }: { message: RevealMessage; numberOf: Map<string, number> }) {
  const premises = message.premiseStatementIds ?? [];
  return (
    <div className="mt-xs rounded-md border border-dashed border-hairline px-sm py-xs text-[12px] leading-[1.6] text-muted">
      {premises.length > 0 ? (
        <p>
          としおはこのとき、直前のシオリの話のうち
          {premises.map((id) => (
            <span key={id} className="mx-[2px] rounded-pill bg-error px-[6px] py-[1px] text-[10px] font-medium text-on-primary">
              {numberOf.get(id)}
            </span>
          ))}
          が嘘だと知ったうえで、話を合わせていました。
        </p>
      ) : (
        <p>直前のシオリの話には、嘘として記録された箇所はありません。</p>
      )}
      <p className="mt-[2px] text-muted-soft">としおの発言は、一文ごとの真偽を判定していません。</p>
    </div>
  );
}

function Transcript({ data }: { data: Revealed }) {
  const statementsById = useMemo(() => new Map(data.statements.map((s) => [s.id, s])), [data.statements]);
  const numberOf = useMemo(() => new Map(data.statements.map((s, i) => [s.id, i + 1])), [data.statements]);

  return (
    <section className="space-y-xs">
      {data.messages.map((m) => {
        if (m.role === "user") {
          return (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-surface-card px-sm py-xs text-[14px] leading-[1.55] text-body">
                {m.content}
              </p>
            </div>
          );
        }
        const isToshio = m.speaker === "toshio";

        return (
          <article
            key={m.id}
            id={isToshio ? toshioAnchorId(m.id) : undefined}
            data-testid="reveal-message"
            className="flex gap-sm py-xs scroll-mt-lg"
          >
            <Mascot size={32} animated={false} character={m.speaker} name={speakerName(m.speaker)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-xs">
                <span className="text-[14px] font-medium text-ink">{speakerName(m.speaker)}</span>
                {isToshio && (
                  <span className="rounded-pill border border-hairline px-xs py-[1px] text-[10px] text-muted-soft">考察</span>
                )}
                <span className="text-[12px] text-muted-soft">{formatTime(m.createdAt)}</span>
              </div>
              <MessageBody message={m} statementsById={statementsById} numberOf={numberOf} />
              {isToshio && <ToshioNote message={m} numberOf={numberOf} />}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ResultPhase({ sessionId, data }: { sessionId: string; data: Revealed }) {
  return (
    <>
      <ResultSummary data={data} />
      {data.statements.length > 0 && (
        <section className="mt-xl" aria-labelledby="answers-title">
          <h2 id="answers-title" className="text-title-md font-medium text-ink">話の答え</h2>
          <p className="mt-xs text-[13px] text-muted">会話に出てきた順に、本当の設定と作り話を並べています。</p>
          <ol className="mt-xs">
            {data.statements.map((statement, i) => (
              <StatementRow key={statement.id} statement={statement} number={i + 1}
                guess={data.reveal.guesses[statement.id]}
                located={data.messages.some((m) => m.segments.some((s) => s.statementId === statement.id))} />
            ))}
          </ol>
        </section>
      )}
      <section className="mt-xxl">
        <h2 className="text-title-md font-medium text-ink">会話をふりかえる</h2>
        <div className="mt-sm"><Legend hasUntrackedMessages={data.hasUntrackedMessages} /></div>
        <div className="mt-lg"><Transcript data={data} /></div>
      </section>
      {data.graph.nodes.some((node) => node.kind === "statement") && (
        <details className="mt-xl rounded-lg border border-hairline p-md">
          <summary className="cursor-pointer text-[14px] font-medium text-ink">話のつながりを図で見る</summary>
          <RevealGraph graph={data.graph} />
        </details>
      )}

      <div className="mt-xl flex flex-wrap justify-center gap-xs">
        <Link
          href={`/chat/${sessionId}`}
          className="rounded-md border border-hairline px-md py-xs text-[14px] font-medium text-body hover:bg-surface-card hover:text-ink"
        >
          会話に戻る
        </Link>
        <Link
          href="/"
          className="rounded-md bg-primary px-md py-xs text-[14px] font-medium text-on-primary hover:bg-primary-active"
        >
          別の会話を始める
        </Link>
      </div>
    </>
  );
}

export function RevealView({ sessionId }: { sessionId: string }) {
  const [work, setWork] = useState<Work | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [data, setData] = useState<RevealData | null>(null);
  const [guesses, setGuesses] = useState<Record<string, Verdict>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sessionData, reveal] = await Promise.all([getSessionData(sessionId), getReveal(sessionId)]);
        if (cancelled) return;
        setWork(sessionData.work);
        setSession(sessionData.session);
        setData(reveal);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      setData(await submitReveal(sessionId, guesses));
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "答え合わせに失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-[14px] text-muted">読み込み中……</p>
      </Shell>
    );
  }
  if (!data || !work || !session) {
    return (
      <Shell>
        <p className="text-[14px] text-muted">{error ?? "セッションが見つかりませんでした。"}</p>
      </Shell>
    );
  }

  return (
    <Shell wide={data.status === "revealed"}>
      <Link href={`/chat/${sessionId}`} className="text-[13px] text-primary hover:underline">
        ← チャットに戻る
      </Link>
      <h1 className="mt-sm font-display text-display-sm font-medium text-ink">答え合わせ</h1>
      <p className="mt-xxs text-[13px] text-muted">
        {work.title} ・ {session.progressDescription ?? `第${session.currentEpisode}話まで`}
        {data.status === "revealed" && ` ・ ${formatTime(data.reveal.revealedAt)} に答え合わせ済み`}
      </p>

      {error && <p className="mt-sm rounded-md bg-[#c6435a1a] px-sm py-xs text-[13px] text-error">{error}</p>}

      {data.status === "pending" ? (
        <GuessPhase
          sessionId={sessionId}
          questions={data.questions}
          guesses={guesses}
          onGuess={(id, v) =>
            setGuesses((prev) => {
              const next = { ...prev };
              if (v) next[id] = v;
              else delete next[id];
              return next;
            })
          }
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      ) : (
        <ResultPhase sessionId={sessionId} data={data} />
      )}
    </Shell>
  );
}
