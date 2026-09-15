"use client";

import Link from "next/link";
import { Mascot } from "@/components/ui/Mascot";
import { PlusIcon, XIcon } from "@/components/ui/icons";
import type { SessionSummary } from "@/lib/client/api";
import { sessionLabel } from "@/lib/client/types";
import type { Work } from "@/lib/server/types";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  work: Work;
  sessions: SessionSummary[];
  activeSessionId: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function Sidebar({ isOpen, onClose, work, sessions, activeSessionId }: SidebarProps) {
  const totalFabricated = sessions.reduce((sum, s) => sum + s.fabricatedFactCount, 0);
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
            <Mascot size={44} />
            <span className="font-display text-[20px] leading-none text-ink">シオリ</span>
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
          <Link
            href="/"
            className="flex w-full items-center gap-sm rounded-md border border-hairline bg-canvas px-sm py-xs text-[14px] font-medium text-ink shadow-sm transition-colors hover:bg-surface-soft"
          >
            <PlusIcon width={17} height={17} />
            新しいセッション
          </Link>
        </div>

        <div className="mt-md px-sm">
          <p className="px-sm pb-xxs font-display text-[13px] tracking-[1.5px] text-muted-soft">作品</p>
          <div className="rounded-lg bg-surface-card px-sm py-sm">
            <p className="text-[15px] font-medium text-ink">{work.title}</p>
            <dl className="mt-xs space-y-[2px] text-[12px] text-muted">
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
              <div className="flex justify-between">
                <dt>生成された嘘</dt>
                <dd>{totalFabricated}件</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-sm flex-1 overflow-y-auto px-sm pb-sm">
          <p className="px-sm pb-xxs pt-sm font-display text-[13px] tracking-[1.5px] text-muted-soft">
            セッション
          </p>
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/chat/${s.id}`}
              className={`block rounded-md px-sm py-xs text-[13px] transition-colors ${
                s.id === activeSessionId ? "bg-surface-card font-medium text-ink" : "text-body hover:bg-surface-soft hover:text-ink"
              }`}
            >
              <div className="flex items-center justify-between gap-xs">
                <span className="truncate">{sessionLabel(s)}</span>
                <span className="shrink-0 text-[11px] text-muted-soft">
                  {s.reveal ? "答え合わせ済み" : `${s.fabricatedFactCount}件`}
                </span>
              </div>
              <span className="text-[11px] text-muted-soft">{formatDateTime(s.updatedAt)}</span>
            </Link>
          ))}
        </div>
      </aside>
    </>
  );
}
