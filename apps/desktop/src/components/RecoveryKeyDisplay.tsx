import { useEffect, useState } from "react";
import { Button } from "./ui/Button";

export function RecoveryKeyDisplay({ value }: { value: string }) {
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  useEffect(() => setRevealedValue(null), [value]);
  const revealed = revealedValue === value;
  return (
    <div
      className="mb-3 rounded-lg border p-3"
      style={{
        background: "var(--bg-base)",
        borderColor: "var(--border-subtle)",
        color: "var(--text)",
      }}
    >
      <div
        className="break-all font-mono text-xs"
        aria-hidden={!revealed}
        style={{
          filter: revealed ? undefined : "blur(5px)",
          userSelect: revealed ? "text" : "none",
        }}
      >
        {revealed ? value : value.replace(/[A-Za-z0-9]/g, "•")}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="mt-2"
        aria-expanded={revealed}
        onClick={() => setRevealedValue(revealed ? null : value)}
      >
        {revealed ? "Hide recovery key" : "Show recovery key"}
      </Button>
    </div>
  );
}
