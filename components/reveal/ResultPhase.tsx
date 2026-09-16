"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Mascot } from "@/components/ui/Mascot";
import { formatTime } from "@/lib/client/format";
import type { RevealMessage, RevealStatement } from "@/lib/server/reveal/types";
import { MARK_CLASS, speakerName, type Revealed } from "./verdict";

// --- 結果フェーズ: 真偽をマークした会話だけ ---
// 件数・解説・根拠・注釈は出さない（どこが嘘かの印だけを見せ、理由は作品を見て確かめてもらう）

function Legend() {
  return (
    <div className="space-y-xxs text-[12px] text-muted">
      <div className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
        <span>
          <mark
            className={`rounded-[3px] px-[3px] text-ink underline decoration-2 underline-offset-4 ${MARK_CLASS.lie}`}
          >
            嘘
          </mark>
          <span className="ml-xxs">シオリの作り話</span>
        </span>
        <span>
          <mark
            className={`rounded-[3px] px-[3px] text-ink underline decoration-2 underline-offset-4 ${MARK_CLASS.true}`}
          >
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
}: {
  message: RevealMessage;
  statementsById: Map<string, RevealStatement>;
}) {
  // 本文中に位置を付けられなかった主張（旧データで quote が無い・抜き出しが本文と一致しない）。
  // 本文の印だけだと保存された嘘が消えてしまうので、本文の下に印付きで並べる
  const placed = new Set(
    message.segments.map((seg) => seg.statementId).filter(Boolean),
  );
  const unplaced = message.statementIds
    .filter((id) => !placed.has(id))
    .map((id) => statementsById.get(id))
    .filter((st): st is RevealStatement => st !== undefined);

  return (
    <>
      <p className="mt-xxs whitespace-pre-wrap text-[15px] leading-[1.75] text-body">
        {message.segments.map((seg, i) => {
          const st = seg.statementId
            ? statementsById.get(seg.statementId)
            : undefined;
          if (!st) return <span key={i}>{seg.text}</span>;
          return (
            <mark
              key={i}
              className={`rounded-[3px] px-[2px] text-ink underline decoration-2 underline-offset-4 [box-decoration-break:clone] ${MARK_CLASS[st.verdict]}`}
            >
              {seg.text}
            </mark>
          );
        })}
      </p>
      {unplaced.length > 0 && (
        <ul
          data-testid="reveal-unplaced"
          className="mt-xxs space-y-xxs text-[13px] leading-[1.6] text-body"
        >
          {unplaced.map((st) => (
            <li key={st.id}>
              <mark
                className={`rounded-[3px] px-[2px] text-ink underline decoration-2 underline-offset-4 [box-decoration-break:clone] ${MARK_CLASS[st.verdict]}`}
              >
                {st.claim}
              </mark>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Transcript({ data }: { data: Revealed }) {
  const statementsById = useMemo(
    () => new Map(data.statements.map((s) => [s.id, s])),
    [data.statements],
  );

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
        return (
          <article
            key={m.id}
            data-testid="reveal-message"
            className="flex gap-sm py-xs"
          >
            <Mascot
              size={32}
              animated={false}
              character={m.speaker}
              expression={m.expression}
              name={speakerName(m.speaker)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-xs">
                <span className="text-[14px] font-medium text-ink">
                  {speakerName(m.speaker)}
                </span>
                <span className="text-[12px] text-muted-soft">
                  {formatTime(m.createdAt)}
                </span>
              </div>
              <MessageBody message={m} statementsById={statementsById} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function ResultPhase({
  sessionId,
  data,
  onNewSession,
  creatingSession,
  newSessionError,
}: {
  sessionId: string;
  data: Revealed;
  /** 同じ作品で新しいセッションを作ってそのチャットに移る（スタート画面の「シオリと話す」と同じ） */
  onNewSession: () => void;
  creatingSession: boolean;
  newSessionError: string | null;
}) {
  return (
    <>
      <section className="mt-xl">
        <Legend />
        <div className="mt-lg">
          <Transcript data={data} />
        </div>
      </section>

      <div className="mt-xl flex flex-wrap justify-center gap-xs">
        <Link
          href={`/chat/${sessionId}`}
          className="rounded-md border border-hairline px-md py-xs text-[14px] font-medium text-body hover:bg-surface-card hover:text-ink"
        >
          会話に戻る
        </Link>
        <button
          type="button"
          onClick={onNewSession}
          disabled={creatingSession}
          className="rounded-md bg-primary px-md py-xs text-[14px] font-medium text-on-primary enabled:hover:bg-primary-active disabled:bg-primary-disabled"
        >
          別の会話を始める
        </button>
      </div>
      {newSessionError && (
        <p role="alert" className="mt-sm text-center text-[13px] text-error">
          {newSessionError}
        </p>
      )}
    </>
  );
}
