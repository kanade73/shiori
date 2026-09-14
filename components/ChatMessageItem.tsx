"use client";

import Link from "next/link";
import { useState } from "react";
import { Mascot } from "./Mascot";
import { CopyIcon } from "./icons";
import { formatTime, type ViewMessage } from "@/lib/client/types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard access denied - silently ignore
        }
      }}
      className="rounded-md p-xxs text-muted-soft transition-colors hover:bg-surface-card hover:text-body"
      aria-label="コピー"
    >
      {copied ? <span className="text-[11px]">Copied</span> : <CopyIcon width={15} height={15} />}
    </button>
  );
}

export function ChatMessageItem({ message, sessionId }: { message: ViewMessage; sessionId: string }) {
  if (message.role === "user") {
    return (
      <div className="animate-fade-up flex justify-end px-md py-xxs">
        <div className="max-w-[80%] rounded-lg bg-surface-card px-sm py-xs text-[15px] leading-[1.55] text-ink">
          {message.content}
          <p className="mt-xxs text-right text-[12px] text-muted-soft">{formatTime(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  const hasFacts = (message.fabricatedFactIds?.length ?? 0) > 0;

  return (
    <div className="group animate-fade-up flex gap-sm px-md py-xs">
      <Mascot size={32} delay={0.4} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-xs">
          <span className="text-[14px] font-medium text-ink">シオリ</span>
          <span className="text-[12px] text-muted-soft">{formatTime(message.createdAt)}</span>
        </div>
        <p className="mt-xxs whitespace-pre-wrap text-[15px] leading-[1.55] text-body">
          {message.content}
          {message.isStreaming && <span className="ml-[1px] inline-block h-[1em] w-[2px] animate-pulse bg-muted align-middle" />}
        </p>
        {!message.isStreaming && (
          <div className="mt-xs flex items-center gap-xs opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            {hasFacts && (
              <Link
                href={`/debug/${sessionId}`}
                className="rounded-pill border border-hairline px-xs py-[2px] text-[11px] text-muted transition-colors hover:bg-surface-card hover:text-ink"
              >
                設定を確認
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
