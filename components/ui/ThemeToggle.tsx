"use client";

import { MoonIcon, SunIcon } from "./icons";

/**
 * ライト/ダークの切り替え。選択は localStorage("theme") に保存し、
 * 次回以降は layout.tsx の初期化スクリプトがそれを読んで data-theme に反映する。
 * 未選択のときは OS の設定（prefers-color-scheme）に従う。
 *
 * アイコンの出し分けは JS の state ではなく [data-theme] 連動の CSS で行う。
 * SSR 時点でテーマが読めなくても描画が一致し、ハイドレーションのずれを起こさない。
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage が使えない環境では保存を諦める（見た目の切り替えだけは効かせる）
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`rounded-md p-xxs text-muted transition-colors hover:bg-surface-card hover:text-ink ${className}`}
      aria-label="テーマを切り替え"
      title="テーマを切り替え"
    >
      {/* ダーク時は「ライトに戻す」太陽、ライト時は「ダークにする」月を出す */}
      <SunIcon width={18} height={18} className="hidden [data-theme='dark']:block" />
      <MoonIcon width={18} height={18} className="[data-theme='dark']:hidden" />
    </button>
  );
}
