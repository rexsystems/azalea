import { useEffect, useState } from "react";
import { Loader2 } from "./icons";

export type ReconnectPhase = "disconnected" | "checking" | "reconnecting";

export interface ReconnectInfo {
  attempt: number;
  nextRetryAt: number;
  phase: ReconnectPhase;
  lastError?: string;
}

interface ReconnectOverlayProps {
  hostName: string;
  info: ReconnectInfo;
  onCloseSession: () => void;
  onRetryNow: () => void;
}

function phaseCopy(phase: ReconnectPhase): { title: string; detail: string } {
  switch (phase) {
    case "disconnected":
      return {
        title: "Disconnected",
        detail: "Session dropped. Waiting before the next check…",
      };
    case "checking":
      return {
        title: "Checking if host is up…",
        detail: "Probing reachability before reconnecting.",
      };
    case "reconnecting":
      return {
        title: "Reconnecting…",
        detail: "Opening a new SSH session.",
      };
  }
}

export function ReconnectOverlay({
  hostName,
  info,
  onCloseSession,
  onRetryNow,
}: ReconnectOverlayProps) {
  const [now, setNow] = useState(() => Date.now());
  const copy = phaseCopy(info.phase);
  const remainingMs = Math.max(0, info.nextRetryAt - now);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const showCountdown = info.phase !== "reconnecting" && remainingMs > 0;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center p-6"
      style={{
        background: "color-mix(in srgb, var(--terminal-bg) 78%, transparent)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border px-6 py-7 text-center shadow-xl"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background: "var(--accent-muted)",
            color: "var(--accent)",
          }}
        >
          <Loader2 size={22} className="animate-spin" />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {copy.title}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {hostName}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {copy.detail}
          </p>
          {info.lastError && (
            <p className="pt-1 font-mono text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {info.lastError}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>
            Attempt {Math.max(1, info.attempt)}
            {showCountdown ? ` · next try in ${remainingSec}s` : ""}
          </span>
        </div>

        <div className="flex w-full items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onCloseSession}
            className="hover-subtle transition-ui rounded-lg px-3 py-2 text-xs font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Close session
          </button>
          <button
            type="button"
            onClick={onRetryNow}
            className="transition-ui rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg, #fff)",
            }}
          >
            Retry now
          </button>
        </div>
      </div>
    </div>
  );
}
