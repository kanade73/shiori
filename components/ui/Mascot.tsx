"use client";

import { useMemo } from "react";
import type { Speaker } from "@/lib/server/types";

type MascotVariant = "avatar" | "display";

interface MascotProps {
  size?: number;
  variant?: MascotVariant;
  /** 話者。画像の出し分けに使う。既定はシオリ。 */
  character?: Speaker;
  animated?: boolean;
  delay?: number;
  className?: string;
  /** alt テキストに使う表示名。 */
  name?: string;
}

const AVATAR_SOURCES: Record<Speaker, { maxSize: number; src: string }[]> = {
  shiori: [
    { maxSize: 80, src: "/character/avatar-64.png" },
    { maxSize: 180, src: "/character/avatar-128.png" },
    { maxSize: Infinity, src: "/character/avatar-256.png" },
  ],
  toshio: [
    { maxSize: 80, src: "/character/toshio-64.png" },
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
 * The portrait mascot used for both the persistent chat avatar (circular
 * crop) and the larger empty-state display (full bust, natural silhouette).
 * The art is a single static frame, so "life" comes only from a slow,
 * whole-image tilt — no per-feature animation (no blink rig) is attempted
 * on this level of detail.
 */
export function Mascot({
  size = 36,
  variant = "avatar",
  character = "shiori",
  animated = true,
  delay = 0,
  className = "",
  name = "ムラサキ",
}: MascotProps) {
  const isAvatar = variant === "avatar";
  const src = useMemo(
    () => (isAvatar ? pickAvatarSource(size, character) : DISPLAY_SOURCES[character]),
    [isAvatar, size, character],
  );

  return (
    <div
      className={`shrink-0 ${isAvatar ? "rounded-full overflow-hidden bg-surface-card" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        draggable={false}
        className={`image-pixelated block h-full w-full select-none object-cover ${animated ? "animate-tilt" : ""}`}
        style={animated ? { animationDelay: `${delay}s` } : undefined}
      />
    </div>
  );
}
