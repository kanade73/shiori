"use client";

import { useState } from "react";
import { AVATAR_SIZE, Mascot } from "@/components/ui/Mascot";
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
      {copied ? <span className="font-pixel text-[16px]">Copied</span> : <CopyIcon width={15} height={15} />}
    </button>
  );
}

export function ChatMessageItem({ message }: { message: ViewMessage }) {
  if (message.role === "user") {
    return (
      <div className="animate-fade-up flex justify-end px-md py-xxs">
        <div className="pixel-frame pixel-dither max-w-[80%] bg-surface-card px-sm py-xs text-[17px] leading-[1.7] text-ink">
          {message.content}
          <p className="mt-xxs text-right font-pixel text-[16px] text-muted-soft">{formatTime(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  const speakerName = message.speaker === "toshio" ? "としお" : "シオリ";

  return (
    <div className="group animate-fade-up flex gap-sm px-md py-xxs">
      <Mascot size={AVATAR_SIZE} delay={0.4} name={speakerName} character={message.speaker} expression={message.expression} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-xs">
          <span className="font-pixel text-[16px] text-ink">{speakerName}</span>
          <span className="font-pixel text-[16px] text-muted-soft">{formatTime(message.createdAt)}</span>
        </div>
        <p className="mt-xxs whitespace-pre-wrap text-[17px] leading-[1.7] text-body">
          {message.content}
          {message.isStreaming && <span className="ml-[2px] inline-block h-[1em] w-[0.6em] animate-blink bg-body align-middle" />}
        </p>
        {!message.isStreaming && (
          <div className="mt-xs flex items-center gap-xs opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}
