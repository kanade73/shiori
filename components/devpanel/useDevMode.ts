"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 開発者モード（右パネル）の開閉。デモ中にリロードしても戻らないよう localStorage に覚えさせる。
 * サーバー側では常に閉じているものとして描く（初回描画のズレを避ける）。
 */

const DEV_MODE_KEY = "chat.devMode";

const listeners = new Set<() => void>();
// localStorage が使えない環境（プライベートウィンドウなど）では、このタブの間だけ覚える
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(DEV_MODE_KEY) === "1";
  } catch {
    return fallback;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useDevMode(): [boolean, () => void] {
  const devMode = useSyncExternalStore(subscribe, read, () => false);

  const toggle = useCallback(() => {
    const next = !read();
    fallback = next;
    try {
      window.localStorage.setItem(DEV_MODE_KEY, next ? "1" : "0");
    } catch {
      // 覚えられなくても、このタブの間は fallback が効く
    }
    for (const listener of listeners) listener();
  }, []);

  return [devMode, toggle];
}
