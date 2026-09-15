"use client";

import Link from "next/link";
import { Mascot } from "@/components/ui/Mascot";
import { PlusIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import type { SessionSummary } from "@/lib/client/api";
import { sessionLabel } from "@/lib/client/types";
import type { Work } from "@/lib/server/types";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  work: Work;
  sessions: SessionSummary[];
  activeSessionId: string;
  /** ゴミ箱ボタン。確認（DeleteSessionDialog）と削除は呼び出し側で行う */
  onDeleteSession: (sessionId: string) => void;
  /** 今の作品で新しいセッションを作ってそのチャットに移る（スタート画面の「シオリと話す」と同じ） */
  onNewSession: () => void;
  creatingSession: boolean;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function Sidebar({
  isOpen,
  onClose,
  work,
  sessions,
  activeSessionId,
  onDeleteSession,
  onNewSession,
  creatingSession,
}: SidebarProps) {
  const lastChatAt = sessions[0]?.updatedAt;

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-20 bg-ink/30 md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[280px] shrink-0 flex-col border-r border-hairline bg-canvas transition-transform md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-sm px-md py-md">
          <div className="flex items-center gap-sm">
            <Mascot size={52} />
            <span className="font-pixel text-[24px] leading-none text-ink">シオリ</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-xxs text-muted hover:bg-surface-card hover:text-ink md:hidden"
            aria-label="サイドバーを閉じる"
          >
            <XIcon width={18} height={18} />
          </button>
        </div>

        <div className="px-sm">
          <button
            type="button"
            onClick={onNewSession}
            disabled={creatingSession}
            className="pixel-frame pixel-btn flex w-full items-center gap-sm bg-surface-soft px-sm py-xs font-pixel text-[16px] text-ink enabled:hover:bg-surface-card disabled:text-muted"
          >
            <PlusIcon width={17} height={17} />
            新しいセッション
          </button>
        </div>

        <div className="mt-md px-sm">
          <p className="px-sm pb-xxs font-pixel text-[16px] uppercase tracking-[1.5px] text-muted-soft">作品</p>
          <div className="pixel-frame pixel-dither bg-surface-card px-sm py-sm">
            <p className="text-[15px] font-medium text-ink">{work.title}</p>
            <dl className="mt-xs space-y-[2px] font-pixel text-[16px] text-muted">
              <div className="flex justify-between gap-sm">
                <dt className="shrink-0">話題</dt>
                <dd className="text-right">
                  {(() => {
                    const active = sessions.find((s) => s.id === activeSessionId);
                    return active ? sessionLabel(active) : "-";
                  })()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>最終会話</dt>
                <dd>{lastChatAt ? formatDateTime(lastChatAt) : "-"}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-sm flex-1 overflow-y-auto px-sm pb-sm">
          <p className="px-sm pb-xxs pt-sm font-pixel text-[16px] uppercase tracking-[1.5px] text-muted-soft">
            セッション
          </p>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`flex items-center rounded-md text-[15px] transition-colors ${
                s.id === activeSessionId ? "bg-surface-card font-medium text-ink" : "text-body hover:bg-surface-soft hover:text-ink"
              }`}
            >
              <Link href={`/chat/${s.id}`} className="min-w-0 flex-1 py-xs pl-sm">
                <div className="flex items-center justify-between gap-xs">
                  <span className="truncate">{sessionLabel(s)}</span>
                  {s.reveal && (
                    <span className="shrink-0 font-pixel text-[16px] text-muted-soft">答え合わせ済み</span>
                  )}
                </div>
                <span className="font-pixel text-[16px] text-muted-soft">{formatDateTime(s.updatedAt)}</span>
              </Link>
              <button
                type="button"
                onClick={() => onDeleteSession(s.id)}
                className="mx-xxs shrink-0 rounded-md p-xxs text-muted-soft hover:bg-surface-soft hover:text-error"
                aria-label={`「${sessionLabel(s)}」のセッションを削除`}
              >
                <TrashIcon width={16} height={16} />
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
