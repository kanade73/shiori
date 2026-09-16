"use client";

import { useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/ui/Mascot";

interface DeleteSessionDialogProps {
  /** 消そうとしているセッションの見出し（lib/client/types の sessionLabel） */
  sessionLabel: string;
  deleting: boolean;
  error: string | null;
  onConfirm: () => Promise<boolean>;
  onCancel: () => void;
}

/**
 * サイドバーのゴミ箱を押したときの確認。シオリが吹き出しで引き止める。
 * 「いいえ」を「はい」の1.5倍の大きさにして、消さない方へ寄せる。
 * 「はい」では落ち込み、「いいえ」ではウィンクしてから退場する。Esc・背景のクリックではすぐ閉じる。
 */
export function DeleteSessionDialog({ sessionLabel, deleting, error, onConfirm, onCancel }: DeleteSessionDialogProps) {
  const noRef = useRef<HTMLButtonElement>(null);
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  const [exitAction, setExitAction] = useState<"confirm" | "cancel" | null>(null);
  const isLeaving = exitAction !== null;

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  }, [onCancel, onConfirm]);

  useEffect(() => {
    noRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting && !isLeaving) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, isLeaving, onCancel]);

  useEffect(() => {
    if (!exitAction) return;
    const timeout = window.setTimeout(() => {
      if (exitAction === "cancel") {
        onCancelRef.current();
        return;
      }
      void onConfirmRef.current().then((deleted) => {
        if (!deleted) setExitAction(null);
      });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [exitAction]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-md"
      onClick={() => {
        if (!deleting && !isLeaving) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
        aria-describedby="delete-session-target"
        className={`${isLeaving ? "animate-delete-dialog-exit" : "animate-fade-up"} flex flex-col items-center`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pixel-frame pixel-frame-strong pixel-dither bg-surface-card px-md py-sm text-center">
          <p id="delete-session-title" className="font-pixel text-[20px] leading-[1.4] text-ink">
            ほんとうに消しちゃうの...?
          </p>
          <p id="delete-session-target" className="mt-xxs max-w-[260px] truncate text-[13px] text-muted">
            「{sessionLabel}」の会話
          </p>
        </div>
        {/* 吹き出しのしっぽ。ドットの段々で、吹き出しの下の線に重ねてつなぐ */}
        <div aria-hidden className="-mt-[2px] flex flex-col items-center">
          <div className="h-[4px] w-[16px] border-x-2 border-muted-soft bg-surface-card" />
          <div className="h-[4px] w-[10px] border-x-2 border-muted-soft bg-surface-card" />
          <div className="h-[4px] w-[4px] bg-muted-soft" />
        </div>

        <Mascot
          size={160}
          variant="display"
          expression={exitAction === "confirm" ? "sad" : exitAction === "cancel" ? "wink" : "neutral"}
          animated={!isLeaving}
          name="シオリ"
          className="mt-xxs"
        />

        <div className="mt-md flex items-center gap-sm">
          <button
            type="button"
            onClick={() => setExitAction("confirm")}
            disabled={deleting || isLeaving}
            className="pixel-btn h-[40px] w-[96px] border-2 border-hairline bg-canvas font-pixel text-[16px] text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50"
          >
            はい
          </button>
          <button
            ref={noRef}
            type="button"
            onClick={() => setExitAction("cancel")}
            disabled={deleting || isLeaving}
            className="pixel-btn h-[60px] w-[144px] bg-primary font-pixel text-[24px] text-on-primary hover:bg-primary-active disabled:opacity-50"
          >
            いいえ
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-sm text-[13px] text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
