"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Mascot } from "@/components/ui/Mascot";
import { formatTime } from "@/lib/client/format";
import type { RevealMessage, RevealStatement, Verdict } from "@/lib/server/reveal/types";
import { MARK_CLASS, PILL_CLASS, VERDICT_LABEL, outcomeOf, speakerName, type Revealed } from "./verdict";

// --- 結果フェーズ: 概要 → 話の答え → 真偽をマークした会話 ---
// 解説・根拠・注釈は出さない（どこが嘘かの印だけを見せ、理由は作品を見て確かめてもらう）

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
    </section>
  );
}

function Legend() {
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
      </div>
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
}: {
  statement: RevealStatement;
  number: number;
  guess: Verdict | undefined;
}) {
  const outcome = outcomeOf(statement.verdict, guess);

  return (
    <li className="flex gap-sm border-b border-hairline py-lg">
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
      </div>
    </li>
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
          <article key={m.id} data-testid="reveal-message" className="flex gap-sm py-xs">
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
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function ResultPhase({ sessionId, data }: { sessionId: string; data: Revealed }) {
  return (
    <>
      <ResultSummary data={data} />
      {data.statements.length > 0 && (
        <section className="mt-xl" aria-labelledby="answers-title">
          <h2 id="answers-title" className="text-title-md font-medium text-ink">話の答え</h2>
          <ol className="mt-xs">
            {data.statements.map((statement, i) => (
              <StatementRow
                key={statement.id}
                statement={statement}
                number={i + 1}
                guess={data.reveal.guesses[statement.id]}
              />
            ))}
          </ol>
        </section>
      )}
      <section className="mt-xxl">
        <h2 className="text-title-md font-medium text-ink">会話をふりかえる</h2>
        <div className="mt-sm"><Legend /></div>
        <div className="mt-lg"><Transcript data={data} /></div>
      </section>

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
