"use client";

import Link from "next/link";
import { MenuIcon } from "./icons";

interface ChatHeaderProps {
  workTitle: string;
  currentEpisode: number;
  progressDescription?: string;
  sessionId: string;
  onOpenSidebar: () => void;
}

export function ChatHeader({ workTitle, currentEpisode, progressDescription, sessionId, onOpenSidebar }: ChatHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-canvas px-md">
      <div className="flex min-w-0 items-center gap-xs">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-md p-xxs text-muted hover:bg-surface-card hover:text-ink md:hidden"
          aria-label="サイドバーを開く"
        >
          <MenuIcon width={20} height={20} />
        </button>
        <div className="min-w-0 px-xs py-xxs">
          <span className="truncate text-title-md font-medium text-ink">{workTitle}</span>
          <span className="ml-xs text-[13px] text-muted-soft">{progressDescription ?? `第${currentEpisode}話まで`}</span>
        </div>
      </div>

      <Link
        href={`/debug/${sessionId}`}
        className="shrink-0 rounded-md border border-hairline px-sm py-xxs text-[13px] font-medium text-body transition-colors hover:bg-surface-card hover:text-ink"
      >
        偽設定を確認
      </Link>
    </header>
  );
}
