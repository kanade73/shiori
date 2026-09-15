"use client";

import Link from "next/link";
import { useState } from "react";
import { Mascot } from "@/components/ui/Mascot";
import { CopyIcon } from "@/components/ui/icons";
import { formatTime } from "@/lib/client/format";
import type { ViewMessage } from "@/lib/client/types";

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
      {copied ? <span className="font-pixel text-[12px]">Copied</span> : <CopyIcon width={15} height={15} />}
    </button>
  );
}

export function ChatMessageItem({ message, sessionId }: { message: ViewMessage; sessionId: string }) {
  if (message.role === "user") {
    return (
      <div className="animate-fade-up flex justify-end px-md py-xxs">
        <div className="pixel-frame pixel-dither max-w-[80%] bg-surface-card px-sm py-xs text-[15px] leading-[1.55] text-ink">
          {message.content}
          <p className="mt-xxs text-right font-pixel text-[12px] text-muted-soft">{formatTime(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  const hasFacts = (message.fabricatedFactIds?.length ?? 0) > 0;
  const isToshio = message.speaker === "toshio";
  const speakerName = isToshio ? "としお" : "シオリ";

  return (
    <div className="group animate-fade-up flex gap-sm px-md py-xxs">
      <Mascot size={40} delay={0.4} name={speakerName} character={message.speaker} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-xs">
          <span className="font-pixel text-[15px] text-ink">{speakerName}</span>
          {isToshio && (
            <span className="border-2 border-hairline px-xs py-[1px] font-pixel text-[11px] leading-none text-muted-soft">考察</span>
          )}
          <span className="font-pixel text-[12px] text-muted-soft">{formatTime(message.createdAt)}</span>
        </div>
        <p className="mt-xxs whitespace-pre-wrap text-[15px] leading-[1.55] text-body">
          {message.content}
          {message.isStreaming && <span className="ml-[2px] inline-block h-[1em] w-[0.6em] animate-blink bg-body align-middle" />}
        </p>
        {!message.isStreaming && (
          <div className="mt-xs flex items-center gap-xs opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
            {hasFacts && (
              <Link
                href={`/debug/${sessionId}`}
                className="border-2 border-hairline px-xs py-[2px] font-pixel text-[12px] text-muted hover:bg-surface-card hover:text-ink"
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
