import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ConnectionErrorDialogProps {
  open: boolean;
  title: string;
  hostName: string;
  message: string;
  logs: string[];
  onClose: () => void;
  onRetry?: () => void;
}

export function ConnectionErrorDialog({
  open,
  title,
  hostName,
  message,
  logs,
  onClose,
  onRetry,
}: ConnectionErrorDialogProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close" />
      <div
        className="animate-menu-in relative flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border)",
        }}
      >
        <div className="border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <h3 className="text-base font-semibold" style={{ color: "#f87171" }}>
            {title}
          </h3>
          <p className="mt-1 text-sm font-medium" style={{ color: "var(--text)" }}>
            {hostName}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            {message}
          </p>
        </div>

        {logs.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Log
            </p>
            <pre
              className="rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-base)",
                color: "var(--text-secondary)",
              }}
            >
              {logs.join("\n")}
            </pre>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {onRetry && (
            <Button variant="primary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
