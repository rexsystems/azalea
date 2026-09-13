import type { Host } from "@azalea/shared";
import { Loader2, Server, SquareTerminal } from "../icons";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export type SelectHostResult = {
  ok: boolean;
  message: string;
};

export type OpenSessionOption = {
  id: string;
  title: string;
  subtitle: string;
  local?: boolean;
};

interface SelectHostDialogProps {
  open: boolean;
  title: string;
  message?: string;
  hosts: Host[];
  /** Optional open terminals to pick instead of opening a new host session. */
  sessions?: OpenSessionOption[];
  busy?: boolean;
  result?: SelectHostResult | null;
  onSelect: (host: Host) => void;
  onSelectSession?: (sessionId: string) => void;
  onCancel: () => void;
}

export function SelectHostDialog({
  open,
  title,
  message,
  hosts,
  sessions = [],
  busy = false,
  result = null,
  onSelect,
  onSelectSession,
  onCancel,
}: SelectHostDialogProps) {
  if (!open) return null;

  const hasSessions = sessions.length > 0 && Boolean(onSelectSession);
  const empty = !hasSessions && hosts.length === 0;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
        onClick={() => {
          if (!busy) onCancel();
        }}
        disabled={busy}
      />
      <div
        className="animate-menu-in relative w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          {result ? (result.ok ? "Key installed" : "Install failed") : title}
        </h3>

        {result ? (
          <>
            <p
              className="mt-2 whitespace-pre-line break-words text-sm"
              style={{ color: result.ok ? "var(--text-secondary)" : "#f87171" }}
            >
              {result.message}
            </p>
            <div className="mt-5 flex justify-end">
              <Button onClick={onCancel}>OK</Button>
            </div>
          </>
        ) : (
          <>
            {message && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {message}
              </p>
            )}

            {busy ? (
              <div
                className="mt-4 flex items-center gap-2 text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                <Loader2 size={16} className="animate-spin shrink-0" />
                Connecting and installing key…
              </div>
            ) : empty ? (
              <p className="mt-4 text-sm text-amber-200">Nothing available.</p>
            ) : (
              <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
                {hasSessions && (
                  <div className="space-y-2">
                    <div
                      className="px-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Open terminals
                    </div>
                    {sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => onSelectSession?.(session.id)}
                        className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
                        style={{
                          borderColor: "var(--border-subtle)",
                          background: "var(--bg-card)",
                        }}
                      >
                        <SquareTerminal size={18} style={{ color: "var(--accent)" }} />
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {session.title}
                          </div>
                          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                            {session.subtitle}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {hosts.length > 0 && (
                  <div className="space-y-2">
                    {hasSessions && (
                      <div
                        className="px-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: "var(--text-muted)" }}
                      >
                        New from host
                      </div>
                    )}
                    {hosts.map((host) => (
                      <button
                        key={host.id}
                        type="button"
                        onClick={() => onSelect(host)}
                        className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
                        style={{
                          borderColor: "var(--border-subtle)",
                          background: "var(--bg-card)",
                        }}
                      >
                        <Server size={18} style={{ color: "var(--accent)" }} />
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {host.name}
                          </div>
                          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                            {host.username}@{host.hostname}:{host.port}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <Button variant="secondary" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
