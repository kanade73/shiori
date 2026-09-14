"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getReveal, getSessionData, submitReveal } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import type { ChatSession, Work } from "@/lib/server/types";
import type { RevealData, Verdict } from "@/lib/server/reveal/types";
import { GuessPhase } from "./GuessPhase";
import { ResultPhase } from "./ResultPhase";

function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh bg-canvas px-md pb-section pt-lg">
      <div className={`mx-auto ${wide ? "max-w-[800px]" : "max-w-[760px]"}`}>{children}</div>
    </div>
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
