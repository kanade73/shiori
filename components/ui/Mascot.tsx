"use client";

import { useMemo } from "react";
import type { ShioriExpression, Speaker } from "@/lib/server/types";

type MascotVariant = "avatar" | "display";

interface MascotProps {
  size?: number;
  variant?: MascotVariant;
  /** 話者。画像の出し分けに使う。既定はシオリ。 */
  character?: Speaker;
  /** シオリの表情（pictures/ の差分から作った画像）。sad は削除確認専用。としおには無い。既定は neutral */
  expression?: ShioriExpression | "sad";
  animated?: boolean;
  delay?: number;
  className?: string;
  /** alt テキストに使う表示名。 */
  name?: string;
}

/**
 * 吹き出しのアバターの大きさ。表情の差（眉と口の数ピクセル）が 44px では伝わらなかったので、
 * 会話の中で顔として読める大きさにしている（128px の画像を使う）
 */
export const AVATAR_SIZE = 72;

const AVATAR_SOURCES: Record<Speaker, { maxSize: number; src: string }[]> = {
  shiori: [
    { maxSize: 64, src: "/character/avatar-64.png" },
    { maxSize: 180, src: "/character/avatar-128.png" },
    { maxSize: Infinity, src: "/character/avatar-256.png" },
  ],
  toshio: [
    { maxSize: 64, src: "/character/toshio-64.png" },
    { maxSize: 180, src: "/character/toshio-128.png" },
    { maxSize: Infinity, src: "/character/toshio-256.png" },
  ],
};

const DISPLAY_SOURCES: Record<Speaker, string> = {
  shiori: "/character/display-512.png",
  toshio: "/character/toshio-display-512.png",
};

function pickAvatarSource(size: number, character: Speaker) {
  const sources = AVATAR_SOURCES[character];
  return sources.find((entry) => size <= entry.maxSize)?.src ?? sources[sources.length - 1].src;
}

/**
 * 表情つきの画像は `/character/avatar-<expression>-<size>.png` / `display-<expression>-512.png`。
 * neutral は元からある無印のファイル。としおには表情差分が無いので常に無印
 */
function withExpression(src: string, character: Speaker, expression: ShioriExpression | "sad"): string {
  if (character !== "shiori" || expression === "neutral") return src;
  return src.replace(/\/(avatar|display)-/, `/$1-${expression}-`);
}

/**
 * The portrait mascot used for both the persistent chat avatar (square pixel
 * frame) and the larger empty-state display (full bust, natural silhouette).
 * The art is a single static frame, so "life" comes only from a slow,
 * whole-image tilt — no per-feature animation (no blink rig) is attempted
 * on this level of detail.
 */
export function Mascot({
  size = 36,
  variant = "avatar",
  character = "shiori",
  expression = "neutral",
  animated = true,
  delay = 0,
  className = "",
  name = "ムラサキ",
}: MascotProps) {
  const isAvatar = variant === "avatar";
  const src = useMemo(
    () => withExpression(isAvatar ? pickAvatarSource(size, character) : DISPLAY_SOURCES[character], character, expression),
    [isAvatar, size, character, expression],
  );

  return (
    <div
      className={`shrink-0 ${isAvatar ? "pixel-frame overflow-hidden bg-surface-card" : ""} ${className}`}
      style={{ width: size, height: size }}
      data-expression={character === "shiori" ? expression : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        draggable={false}
        data-pixel=""
        className={`block h-full w-full select-none object-cover ${animated ? "animate-tilt" : ""}`}
        style={animated ? { animationDelay: `${delay}s` } : undefined}
      />
    </div>
  );
}
