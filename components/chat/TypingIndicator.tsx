import { AVATAR_SIZE, Mascot } from "@/components/ui/Mascot";
import type { ShioriExpression, Speaker } from "@/lib/server/types";

/** 本文がまだ届いていない返答の吹き出し。としおの割り込みでは としおの顔を出す。表情は message-start で決まっている */
export function TypingIndicator({ speaker, expression }: { speaker?: Speaker; expression?: ShioriExpression }) {
  return (
    <div className="flex animate-fade-up items-center gap-sm px-md py-xxs">
      <Mascot
        size={AVATAR_SIZE}
        delay={0.4}
        character={speaker}
        expression={expression}
        name={speaker === "toshio" ? "としお" : undefined}
      />
      <div className="flex items-center gap-1 rounded-lg px-xs py-xs">
        <span className="sr-only">入力中</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="animate-typing-dot h-[6px] w-[6px] bg-muted-soft"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
    </div>
  );
}
