"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mascot } from "@/components/ui/Mascot";
import { createSession, listSessions, listWorks, type SessionSummary } from "@/lib/client/api";
import { sessionLabel } from "@/lib/client/types";
import type { Work } from "@/lib/server/types";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

// issue #14: 話数（どこまで見たか）は聞かない。話題の場面は、シオリの最初の問いかけへの答えから調べる。
// スタート画面のデザインは別途（issue #14 のUI担当）
export function SetupScreen() {
  const router = useRouter();
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listWorks()
      .then((list) => {
        if (cancelled) return;
        setWorks(list);
        if (list[0]) setSelectedWorkId(list[0].id);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "作品の取得に失敗しました"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkId) return;
    listSessions(selectedWorkId)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [selectedWorkId]);

  const selectedWork = works.find((w) => w.id === selectedWorkId) ?? null;

  async function handleStart() {
    if (!selectedWork) return;
    setStarting(true);
    setError(null);
    try {
      const { sessionId } = await createSession(selectedWork.id);
      router.push(`/chat/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "セッションの作成に失敗しました");
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <p className="text-[14px] text-muted">読み込み中……</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col items-center overflow-y-auto bg-canvas px-md py-xl">
      <div className="w-full max-w-[460px]">
        <div className="flex flex-col items-center text-center">
          <Mascot size={128} variant="display" />
          <h1 className="mt-md font-display text-display-sm font-medium text-ink">そんなシーンあった？</h1>
          <p className="mt-xs text-[14px] text-muted">
            話したい場面を教えて。シオリが本物の設定と、時々小さな嘘を混ぜて話すよ。
          </p>
        </div>

        {error && <p className="mt-md rounded-md bg-[#c6435a1a] px-sm py-xs text-center text-[13px] text-error">{error}</p>}

        {!selectedWork ? (
          <p className="mt-lg text-center text-[14px] text-muted">利用できる作品がまだ登録されていません。</p>
        ) : (
          <div className="mt-lg rounded-lg border border-hairline bg-canvas p-md">
            <p className="text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft">作品</p>
            <p className="mt-xxs text-[16px] font-medium text-ink">{selectedWork.title}</p>
            {selectedWork.description && <p className="mt-xxs text-[13px] text-muted">{selectedWork.description}</p>}

            <button
              type="button"
              onClick={handleStart}
              disabled={starting}
              className="mt-md flex w-full items-center justify-center rounded-md bg-primary px-sm py-xs text-[14px] font-medium text-on-primary transition-colors enabled:hover:bg-primary-active disabled:bg-primary-disabled"
            >
              {starting ? "はじめています……" : "シオリと話す"}
            </button>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="mt-lg">
            <p className="px-xxs text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft">続きから</p>
            <div className="mt-xs space-y-xxs">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => router.push(`/chat/${s.id}`)}
                  className="flex w-full items-center justify-between rounded-md border border-hairline px-sm py-xs text-left text-[13px] text-body transition-colors hover:bg-surface-card hover:text-ink"
                >
                  <span>{sessionLabel(s)}</span>
                  <span className="text-[11px] text-muted-soft">{formatDateTime(s.updatedAt)}・嘘{s.fabricatedFactCount}件</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
