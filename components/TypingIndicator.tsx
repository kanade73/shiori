import { Mascot } from "./Mascot";

export function TypingIndicator() {
  return (
    <div className="flex animate-fade-up items-center gap-sm px-md py-xs">
      <Mascot size={32} delay={0.4} />
      <div className="flex items-center gap-1 rounded-lg px-xs py-xs">
        <span className="sr-only">入力中</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="animate-typing-dot h-[6px] w-[6px] rounded-full bg-muted-soft"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
