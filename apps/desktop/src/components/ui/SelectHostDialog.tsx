import type { Host } from "@azalea/shared";
import { Loader2, Server } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

export type SelectHostResult = {
  ok: boolean;
  message: string;
};

interface SelectHostDialogProps {
  open: boolean;
  title: string;
  message?: string;
  hosts: Host[];
  busy?: boolean;
  result?: SelectHostResult | null;
  onSelect: (host: Host) => void;
  onCancel: () => void;
}

export function SelectHostDialog({
  open,
  title,
  message,
  hosts,
  busy = false,
  result = null,
  onSelect,
  onCancel,
}: SelectHostDialogProps) {
  if (!open) return null;

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
            ) : hosts.length === 0 ? (
              <p className="mt-4 text-sm text-amber-200">No hosts available.</p>
            ) : (
              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
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
