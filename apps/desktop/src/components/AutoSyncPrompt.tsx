import { useState } from "react";
import { KeyRound, Loader2, X } from "lucide-react";
import { Button } from "./ui/Button";

interface AutoSyncPromptProps {
  email?: string | null;
  busy: boolean;
  error: string | null;
  onUnlock: (passphrase: string) => void;
  onDisableAutoSync: () => void;
  onSkip: () => void;
}

export function AutoSyncPrompt({
  email,
  busy,
  error,
  onUnlock,
  onDisableAutoSync,
  onSkip,
}: AutoSyncPromptProps) {
  const [passphrase, setPassphrase] = useState("");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-5"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Unlock vault to sync
            </h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Auto-sync is on{email ? ` for ${email}` : ""}. Enter your master passphrase to pull
              the latest cloud vault.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1"
            style={{ color: "var(--text-muted)" }}
            onClick={onSkip}
            aria-label="Skip for now"
          >
            <X size={16} />
          </button>
        </div>

        <input
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
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

        {error && (
          <p className="mt-3 break-words text-xs" style={{ color: "#f87171" }}>
            {error.replace(/^Error:\s*/, "")}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button disabled={busy || !passphrase} onClick={() => onUnlock(passphrase)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={16} />}
            Unlock &amp; sync
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onSkip}>
            Skip for now
          </Button>
        </div>

        <button
          type="button"
          className="mt-4 w-full text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)" }}
          disabled={busy}
          onClick={onDisableAutoSync}
        >
          Turn off auto-sync
        </button>
      </div>
    </div>
  );
}
