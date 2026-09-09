import { useState } from "react";
import { Loader2, X } from "./icons";
import { Button } from "./ui/Button";

interface PostConnectSyncDialogProps {
  instanceLabel: string;
  email?: string | null;
  busy: boolean;
  error: string | null;
  needsUnlock: boolean;
  onUnlock: (passphrase: string) => void;
  onSyncFromVault: () => void;
  onSyncToVault: () => void;
  onSkip: () => void;
}

export function PostConnectSyncDialog({
  instanceLabel,
  email,
  busy,
  error,
  needsUnlock,
  onUnlock,
  onSyncFromVault,
  onSyncToVault,
  onSkip,
}: PostConnectSyncDialogProps) {
  const [passphrase, setPassphrase] = useState("");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-5"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Sync with {instanceLabel}?
            </h3>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Signed in{email ? ` as ${email}` : ""}. This server already has a vault. Pull it down,
              push this profile up, or skip for now.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1"
            style={{ color: "var(--text-muted)" }}
            onClick={onSkip}
            aria-label="Skip"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>

        {needsUnlock && (
          <input
            className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-base)",
              borderColor: "var(--border-subtle)",
              color: "var(--text)",
            }}
            type="password"
            placeholder="Master passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && passphrase && !busy) onUnlock(passphrase);
            }}
            autoFocus
          />
        )}

        {error && (
          <p className="mb-3 break-words text-xs" style={{ color: "#f87171" }}>
            {error.replace(/^Error:\s*/, "")}
          </p>
        )}

        {needsUnlock ? (
          <Button
            className="w-full"
            disabled={busy || !passphrase}
            onClick={() => onUnlock(passphrase)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Unlock vault
          </Button>
        ) : (
          <div className="grid gap-2">
            <Button disabled={busy} onClick={onSyncFromVault}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Sync from vault
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onSyncToVault}>
              Sync to vault
            </Button>
          </div>
        )}

        <button
          type="button"
          className="mt-4 w-full text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)" }}
          disabled={busy}
          onClick={onSkip}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
