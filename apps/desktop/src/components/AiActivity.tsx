import type { CSSProperties } from "react";

/** Split-letter motion inspired by React Bits, scaled down for chat status. */
export function AiActivity({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  return (
    <div
      className="ai-activity flex min-h-6 items-center gap-2 text-[12px] font-medium"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ color: "var(--text-secondary)" }}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "ai-activity-dot" : ""}`}
        aria-hidden="true"
        style={{ background: active ? "var(--accent)" : "var(--text-muted)" }}
      />
      <span className="sr-only">{text}</span>
      <span key={text} aria-hidden="true" className="inline-flex flex-wrap">
        {text.split(/(\s+)/).map((word, index, words) => {
          const offset = words.slice(0, index).join("").length;
          return (
            <span key={index} className="inline-block whitespace-pre">
              {Array.from(word).map((letter, i) => (
                <span
                  key={i}
                  className={
                    active ? "ai-activity-letter inline-block" : "inline-block"
                  }
                  style={
                    {
                      "--ai-letter-delay": `${(offset + i) * 32}ms`,
                    } as CSSProperties
                  }
                >
                  {letter}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </div>
  );
}
