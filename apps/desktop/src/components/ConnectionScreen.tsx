import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { getHostIconColor } from "../lib/theme";
import { getHostInitials } from "../lib/utils";

interface ConnectionScreenProps {
  hostName: string;
  username: string;
  hostname: string;
  port: number;
  status: "connecting" | "error";
  error?: string;
  logs: string[];
}

export function ConnectionScreen({
  hostName,
  username,
  hostname,
  port,
  status,
  error,
  logs,
}: ConnectionScreenProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  const iconColor = getHostIconColor(hostName);
  const portSuffix = port === 22 ? "" : `:${port}`;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="flex w-full max-w-md flex-col items-center">
        <div className="relative mb-5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold text-white"
            style={{ background: iconColor }}
          >
            {getHostInitials(hostName)}
          </div>
          {status === "connecting" && (
            <div
              className="connect-ring absolute -inset-1.5 rounded-[18px]"
              style={{ borderColor: "var(--accent)" }}
            />
          )}
        </div>

        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          {hostName}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {username}@{hostname}
          {portSuffix}
        </p>

        <div className="mt-6 flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {status === "connecting" ? (
            <>
              <Loader2 size={16} className="connect-spin" style={{ color: "var(--accent)" }} />
              Connecting...
            </>
          ) : (
            <span style={{ color: "#f87171" }}>{error ?? "Connection failed"}</span>
          )}
        </div>

        {logs.length > 0 && (
          <div className="mt-8 w-full">
            <button
              type="button"
              onClick={() => setLogsOpen((v) => !v)}
              className="hover-subtle transition-ui flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
                background: "var(--bg-card)",
              }}
            >
              <span>Connection log ({logs.length})</span>
              <ChevronDown
                size={14}
                className={`transition-transform ${logsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {logsOpen && (
              <div
                className="mt-2 max-h-40 overflow-y-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "var(--bg-panel)",
                  color: "var(--text-secondary)",
                }}
              >
                {logs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
