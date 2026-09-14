"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mascot } from "./Mascot";
import {
  createSession,
  listSessions,
  listWorks,
  resolveProgress,
  type SessionSummary,
} from "@/lib/client/api";
import type { ProgressCandidate, Work } from "@/lib/server/types";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

type Step = "describe" | "confirm";

export function SetupScreen() {
  const router = useRouter();
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [resolving, setResolving] = useState(false);
  const [candidates, setCandidates] = useState<ProgressCandidate[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [manualEpisode, setManualEpisode] = useState<number | "">("");
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

  async function handleResolve() {
    if (!selectedWork || !description.trim()) return;
    setResolving(true);
    setError(null);
    try {
      const resolution = await resolveProgress(selectedWork.id, description.trim());
      setCandidates(resolution.candidates);
      setSelectedEpisode(resolution.bestGuess?.episodeNumber ?? null);
      setManualEpisode(resolution.bestGuess?.episodeNumber ?? "");
      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "判定に失敗しました");
    } finally {
      setResolving(false);
    }
  }

  async function handleStart() {
    if (!selectedWork) return;
    const episode = selectedEpisode ?? (typeof manualEpisode === "number" ? manualEpisode : null);
    if (!episode) return;

    setStarting(true);
    setError(null);
    try {
      const { sessionId } = await createSession(selectedWork.id, episode, description.trim() || undefined);
      router.push(`/chat/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "セッションの作成に失敗しました");
      setStarting(false);
    }
  }

  function handleBack() {
    setStep("describe");
    setCandidates([]);
    setSelectedEpisode(null);
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
            どこまで見たか、ざっくりでいいから教えて。シオリが本物の設定と、時々小さな嘘を混ぜて話すよ。
          </p>
        </div>

        {error && <p className="mt-md rounded-md bg-[#c6435a1a] px-sm py-xs text-center text-[13px] text-error">{error}</p>}

        {!selectedWork ? (
          <p className="mt-lg text-center text-[14px] text-muted">利用できる作品がまだ登録されていません。</p>
        ) : step === "describe" ? (
          <div className="mt-lg rounded-lg border border-hairline bg-canvas p-md">
            <p className="text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft">作品</p>
            <p className="mt-xxs text-[16px] font-medium text-ink">{selectedWork.title}</p>
            {selectedWork.description && <p className="mt-xxs text-[13px] text-muted">{selectedWork.description}</p>}

            <label className="mt-md block text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft" htmlFor="progress">
              どこまで見た?
            </label>
            <textarea
              id="progress"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: パジャマパーティーズ編まで見た / 草むしり検定のところ / 第100話くらいまで"
              className="mt-xxs w-full resize-none rounded-md border border-hairline bg-canvas px-sm py-xs text-[15px] text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none"
            />

            <button
              type="button"
              onClick={handleResolve}
              disabled={!description.trim() || resolving}
              className="mt-md flex w-full items-center justify-center rounded-md bg-primary px-sm py-xs text-[14px] font-medium text-on-primary transition-colors enabled:hover:bg-primary-active disabled:bg-primary-disabled"
            >
              {resolving ? "確認中……" : "次へ"}
            </button>
          </div>
        ) : (
          <div className="mt-lg rounded-lg border border-hairline bg-canvas p-md">
            <p className="text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft">入力内容</p>
            <p className="mt-xxs text-[14px] text-body">「{description}」</p>

            {candidates.length > 0 ? (
              <>
                <p className="mt-md text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft">
                  ここまでで合ってる?
                </p>
                <div className="mt-xxs space-y-xxs">
                  {candidates.map((c) => (
                    <label
                      key={`${c.matchedVia}-${c.episodeNumber}`}
                      className={`flex cursor-pointer items-center gap-xs rounded-md border px-sm py-xs text-[14px] transition-colors ${
                        selectedEpisode === c.episodeNumber
                          ? "border-primary bg-surface-card text-ink"
                          : "border-hairline text-body hover:bg-surface-soft"
                      }`}
                    >
                      <input
                        type="radio"
                        name="candidate"
                        className="accent-primary"
                        checked={selectedEpisode === c.episodeNumber}
                        onChange={() => setSelectedEpisode(c.episodeNumber)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-md text-[13px] text-muted">
                うまく判定できなかった。話数を直接指定して。
              </p>
            )}

            <div className="mt-md">
              <label className="block text-[12px] font-medium uppercase tracking-[1.5px] text-muted-soft" htmlFor="manual-episode">
                {candidates.length > 0 ? "違う場合は話数で直接指定" : "視聴話数"}
              </label>
              <div className="mt-xxs flex items-center gap-xs">
                <input
                  id="manual-episode"
                  type="number"
                  min={1}
                  max={selectedWork.episodeCount ?? undefined}
                  value={manualEpisode}
                  onChange={(e) => {
                    const v = e.target.value === "" ? "" : Math.max(1, Number(e.target.value) || 1);
                    setManualEpisode(v);
                    setSelectedEpisode(typeof v === "number" ? v : null);
                  }}
                  className="w-24 rounded-md border border-hairline bg-canvas px-sm py-xs text-[15px] text-ink focus:border-primary focus:outline-none"
                />
                <span className="text-[13px] text-muted">
                  話まで{selectedWork.episodeCount ? `（全${selectedWork.episodeCount}話）` : ""}
                </span>
              </div>
            </div>

            <div className="mt-md flex gap-xs">
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md border border-hairline px-sm py-xs text-[14px] font-medium text-body transition-colors hover:bg-surface-card hover:text-ink"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={handleStart}
                disabled={starting || !selectedEpisode}
                className="flex flex-1 items-center justify-center rounded-md bg-primary px-sm py-xs text-[14px] font-medium text-on-primary transition-colors enabled:hover:bg-primary-active disabled:bg-primary-disabled"
              >
                {starting ? "はじめています……" : "この内容ではじめる"}
              </button>
            </div>
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
                  <span>{s.progressDescription ?? `第${s.currentEpisode}話まで`}</span>
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
