import { useState } from "react";
import { Check, Copy, Loader2, Lock, X } from "./icons";
import { Button } from "./ui/Button";
import { copyText } from "../lib/clipboard";

export type PostConnectMode = "setup" | "unlock";

interface PostConnectSyncDialogProps {
  instanceLabel: string;
  email?: string | null;
  mode: PostConnectMode;
  busy: boolean;
  error: string | null;
  needsUnlock: boolean;
  recoveryKey: string | null;
  onSetup: (passphrase: string) => void;
  onUnlock: (passphrase: string) => void;
  onSyncFromVault: () => void;
  onSyncToVault: () => void;
  onRecoverySaved: () => void;
  onSkip: () => void;
}

export function PostConnectSyncDialog({
  instanceLabel,
  email,
  mode,
  busy,
  error,
  needsUnlock,
  recoveryKey,
  onSetup,
  onUnlock,
  onSyncFromVault,
  onSyncToVault,
  onRecoverySaved,
  onSkip,
}: PostConnectSyncDialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  const copyRecovery = async () => {
    if (!recoveryKey) return;
    await copyText(recoveryKey);
    setRecoveryCopied(true);
    setTimeout(() => setRecoveryCopied(false), 1500);
  };

  const title =
    mode === "setup"
      ? recoveryKey
        ? "Save your recovery key"
        : "Set a master password"
      : "Sync with " + instanceLabel;

  const subtitle = (() => {
    if (mode === "setup" && recoveryKey) {
      return "This is the only way to recover the vault if you forget the master password. It is shown once.";
    }
    if (mode === "setup") {
      return `Signed in${email ? ` as ${email}` : ""} on ${instanceLabel}. This encrypts hosts and keys before they leave this device.`;
    }
    return `Signed in${email ? ` as ${email}` : ""}. This server already has a vault. Unlock it, then pull or push.`;
  })();

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
              {title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          </div>
          {mode === "setup" && !recoveryKey ? null : (
            <button
              type="button"
              className="rounded-md p-1"
              style={{ color: "var(--text-muted)" }}
              onClick={recoveryKey ? onRecoverySaved : onSkip}
              aria-label="Close"
              disabled={busy}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {mode === "setup" && recoveryKey ? (
          <>
            <div
              className="mb-3 break-all rounded-lg border p-3 font-mono text-xs"
              style={{
                background: "var(--bg-base)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            >
              {recoveryKey}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => void copyRecovery()}>
                {recoveryCopied ? <Check size={14} /> : <Copy size={14} />}
                {recoveryCopied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={onRecoverySaved}>I saved it</Button>
            </div>
          </>
        ) : mode === "setup" ? (
          <>
            <input
              className="mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--bg-base)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
              type="password"
              placeholder="Master password (min. 8 characters)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            <input
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--bg-base)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
              type="password"
              placeholder="Confirm master password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !busy &&
                  passphrase.length >= 8 &&
                  passphrase === confirm
                ) {
                  onSetup(passphrase);
                }
              }}
            />
            {error && (
              <p className="mb-3 break-words text-xs" style={{ color: "#f87171" }}>
                {error.replace(/^Error:\s*/, "")}
              </p>
            )}
            <Button
              className="w-full"
              disabled={busy || passphrase.length < 8 || passphrase !== confirm}
              onClick={() => onSetup(passphrase)}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={16} />}
              Create encrypted vault
            </Button>
          </>
        ) : (
          <>
            {needsUnlock && (
              <input
                className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--bg-base)",
                  borderColor: "var(--border-subtle)",
                  color: "var(--text)",
                }}
                type="password"
                placeholder="Master password"
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
          </>
        )}
      </div>
    </div>
  );
}
