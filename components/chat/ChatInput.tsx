"use client";

import { useRef, type KeyboardEvent } from "react";
import { ArrowUpIcon } from "@/components/ui/icons";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

const MAX_LENGTH = 1000;

export function ChatInput({ value, onChange, onSend, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  return (
    <div className="border-t border-hairline bg-canvas px-md py-sm">
      <div className="mx-auto max-w-[760px]">
        <div className="flex items-end gap-xs rounded-xl border border-hairline bg-canvas px-sm py-xs shadow-sm transition-shadow focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(107,84,150,0.15)]">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            maxLength={MAX_LENGTH}
            onChange={(e) => {
              onChange(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            placeholder="感想やシーンの話を送ってみて..."
            className="max-h-40 flex-1 resize-none bg-transparent py-[7px] text-[15px] leading-[1.5] text-ink placeholder:text-muted-soft focus:outline-none"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={!value.trim() || disabled}
            className="mb-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-colors enabled:hover:bg-primary-active disabled:bg-primary-disabled disabled:text-muted-soft"
            aria-label="送信"
          >
            <ArrowUpIcon width={17} height={17} />
          </button>
        </div>

        <div className="mt-xs flex flex-col gap-xxs px-xxs sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted-soft">
            シオリは本物の設定に時々小さな嘘を混ぜて話す、娯楽目的のフィクションです。内容を事実として扱わないでください。
          </p>
          <div className="flex shrink-0 items-center gap-xxs text-[12px] text-muted-soft">
            <span className="h-[6px] w-[6px] rounded-full bg-success" />
            シオリ・オンライン
          </div>
        </div>
      </div>
    </div>
  );
}
