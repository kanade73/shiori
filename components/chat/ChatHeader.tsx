"use client";

import Link from "next/link";
import { MenuIcon } from "@/components/ui/icons";

interface ChatHeaderProps {
  workTitle: string;
  /** 話題の場面（issue #14）。lib/client/types の sessionLabel */
  sessionLabel: string;
  sessionId: string;
  /** 答え合わせ済みか。済んでいればボタンは結果を見る導線になる */
  revealed: boolean;
  onOpenSidebar: () => void;
}

export function ChatHeader({
  workTitle,
  sessionLabel,
  sessionId,
  revealed,
  onOpenSidebar,
}: ChatHeaderProps) {
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
          <span className="ml-xs font-pixel text-[13px] text-muted-soft">{sessionLabel}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-xs">
        <Link
          href={`/debug/${sessionId}`}
          className="hidden px-sm py-xxs font-pixel text-[14px] text-muted hover:bg-surface-card hover:text-ink sm:block"
        >
          偽設定を確認
        </Link>
        <Link
          href={`/reveal/${sessionId}`}
          className="pixel-btn bg-primary px-sm py-xxs font-pixel text-[14px] text-on-primary hover:bg-primary-active"
        >
          {revealed ? "答え合わせの結果" : "答え合わせ"}
        </Link>
      </div>
    </header>
  );
}
