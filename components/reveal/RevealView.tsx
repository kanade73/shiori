"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSession, getSessionData, revealSession } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { sessionLabel } from "@/lib/client/types";
import type { ChatSession, Work } from "@/lib/server/types";
import { ResultPhase } from "./ResultPhase";
import type { Revealed } from "./verdict";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas px-md pb-section pt-lg">
      <div className="mx-auto max-w-[800px]">{children}</div>
    </div>
  );
}

/** 開いた時点で答え合わせを済ませ（予想は取らない）、真偽つきの会話を出す */
export function RevealView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [work, setWork] = useState<Work | null>(null);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [data, setData] = useState<Revealed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newSessionError, setNewSessionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sessionData, reveal] = await Promise.all([getSessionData(sessionId), revealSession(sessionId)]);
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

  /** スタート画面の「シオリと話す」と同じく、同じ作品で新しいセッションを作ってそのチャットに移る */
  async function startNewSession() {
    if (!work || creatingSession) return;
    setCreatingSession(true);
    setNewSessionError(null);
    try {
      const { sessionId: newSessionId } = await createSession(work.id);
      router.push(`/chat/${newSessionId}`);
    } catch (e) {
      setNewSessionError(e instanceof Error ? e.message : "セッションの作成に失敗しました");
      setCreatingSession(false);
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
    <Shell>
      <Link href={`/chat/${sessionId}`} className="text-[13px] text-primary hover:underline">
        ← チャットに戻る
      </Link>
      <h1 className="mt-sm font-display text-display-sm font-medium text-ink">答え合わせ</h1>
      <p className="mt-xxs text-[13px] text-muted">
        {work.title} ・ {sessionLabel(session)} ・{" "}
        {formatTime(data.reveal.revealedAt)} に答え合わせ済み
      </p>

      <ResultPhase
        sessionId={sessionId}
        data={data}
        onNewSession={startNewSession}
        creatingSession={creatingSession}
        newSessionError={newSessionError}
      />
    </Shell>
  );
}
