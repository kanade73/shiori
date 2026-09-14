"use client";

import { useMemo } from "react";

type MascotVariant = "avatar" | "display";

interface MascotProps {
  size?: number;
  variant?: MascotVariant;
  animated?: boolean;
  delay?: number;
  className?: string;
}

const AVATAR_SOURCES = [
  { maxSize: 80, src: "/character/avatar-64.png" },
  { maxSize: 180, src: "/character/avatar-128.png" },
  { maxSize: Infinity, src: "/character/avatar-256.png" },
];

function pickAvatarSource(size: number) {
  return AVATAR_SOURCES.find((entry) => size <= entry.maxSize)?.src ?? AVATAR_SOURCES[AVATAR_SOURCES.length - 1].src;
}

/**
 * The portrait mascot used for both the persistent chat avatar (circular
 * crop) and the larger empty-state display (full bust, natural silhouette).
 * The art is a single static frame, so "life" comes only from a slow,
 * whole-image tilt — no per-feature animation (no blink rig) is attempted
 * on this level of detail.
 */
export function Mascot({ size = 36, variant = "avatar", animated = true, delay = 0, className = "" }: MascotProps) {
  const isAvatar = variant === "avatar";
  const src = useMemo(() => (isAvatar ? pickAvatarSource(size) : "/character/display-512.png"), [isAvatar, size]);

  return (
    <div
      className={`shrink-0 ${isAvatar ? "rounded-full overflow-hidden bg-surface-card" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="ムラサキ"
        draggable={false}
        className={`block h-full w-full select-none object-cover ${animated ? "animate-tilt" : ""}`}
        style={animated ? { animationDelay: `${delay}s` } : undefined}
      />
    </div>
  );
}
