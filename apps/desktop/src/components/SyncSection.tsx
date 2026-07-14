import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
} from "lucide-react";
import * as api from "../lib/api";
import { getStoredAutoSync, setStoredAutoSync } from "../lib/settings";
import { Button } from "./ui/Button";
import { SettingToggle } from "./ui/SettingToggle";
import { SyncResolutionDialog } from "./SyncResolutionDialog";

interface SyncSectionProps {
  getSettings: () => unknown;
  onVaultApplied: (settings: unknown) => void;
  onDataRefresh: () => Promise<void>;
}

type Busy = null | "status" | "auth" | "setup" | "unlock" | "sync";

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none transition-ui";

const inputStyle = {
  background: "var(--bg-base)",
  borderColor: "var(--border-subtle)",
  color: "var(--text)",
} as const;

export function SyncSection({
  getSettings,
  onVaultApplied,
  onDataRefresh,
}: SyncSectionProps) {
  const [status, setStatus] = useState<api.SyncStatus | null>(null);
  const [busy, setBusy] = useState<Busy>("status");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  const [preview, setPreview] = useState<api.SyncPreview | null>(null);
  const [autoSync, setAutoSync] = useState(() => getStoredAutoSync());

  const refreshStatus = useCallback(async () => {
    setBusy("status");
    try {
      setStatus(await api.syncStatus());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const applyOutcome = useCallback(
    async (outcome: api.SyncOutcome) => {
      switch (outcome.status) {
        case "in_sync":
          setNotice(`Already in sync (v${outcome.version}).`);
          break;
        case "pushed":
          setNotice(`Local changes uploaded (v${outcome.version}).`);
          break;
        case "pulled":
          onVaultApplied(outcome.settings);
          await onDataRefresh();
          setNotice(`Cloud vault downloaded (v${outcome.version}).`);
          break;
        case "conflict":
          setError("Sync conflict — choose which version to keep.");
          break;
        case "needs_setup":
        case "locked":
          break;
      }
    },
    [onDataRefresh, onVaultApplied],
  );

  const runPreview = useCallback(async () => {
    const next = await api.syncPreview(getSettings());
    if (next.status === "in_sync") {
      setNotice(`Already in sync (v${next.version}).`);
      return;
    }
    if (
      next.status === "push" ||
      next.status === "pull" ||
      next.status === "conflict"
    ) {
      setPreview(next);
    }
  }, [getSettings]);

  const run = useCallback(
    async (kind: Busy, action: () => Promise<void>) => {
      setBusy(kind);
      setError(null);
      setNotice(null);
      try {
        await action();
        setStatus(await api.syncStatus());
      } catch (err) {
        setError(String(err));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const handleBrowserLogin = () =>
    run("auth", async () => {
      setNotice("Opening your browser… complete the sign-in there, then return here.");
      await api.syncBrowserLogin();
      setNotice("Signed in.");
    });

  const handleSetup = () =>
    run("setup", async () => {
      if (passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters.");
      if (passphrase !== passphraseConfirm) throw new Error("Passphrases do not match.");
      const recovery = await api.syncSetupPassphrase(passphrase, getSettings());
      setRecoveryKey(recovery);
      setPassphrase("");
      setPassphraseConfirm("");
      setNotice("Vault created and pushed to the cloud.");
    });

  const handleUnlock = () =>
    run("unlock", async () => {
      if (useRecovery) {
        await api.syncUnlock({ recoveryKey: passphrase });
      } else {
        await api.syncUnlock({ passphrase });
      }
      setPassphrase("");
      setNotice("Vault unlocked. Review any pending sync changes below.");
      await runPreview();
    });

  const handleSync = () =>
    run("sync", async () => {
      await runPreview();
    });

  const handleApplyPreview = async (resolution?: "keep_local" | "keep_cloud") => {
    setBusy("sync");
    setError(null);
    try {
      const outcome = await api.syncNow(getSettings(), resolution);
      setPreview(null);
      await applyOutcome(outcome);
      setStatus(await api.syncStatus());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = () =>
    run("auth", async () => {
      await api.syncLogout();
      setPreview(null);
    });

  const copyRecovery = async () => {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setRecoveryCopied(true);
    setTimeout(() => setRecoveryCopied(false), 1500);
  };

  const spinner = <Loader2 size={14} className="animate-spin" />;

  const renderBody = () => {
    if (!status) {
      return (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {spinner} Checking sync status...
        </div>
      );
    }

    if (!status.configured) {
      return (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Cloud sync is not configured in this build (missing Supabase settings).
        </p>
      );
    }

    if (!status.logged_in) {
      return (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sign in through your browser to link this device. Creating an account
            and password resets happen on the Azalea website.
          </p>
          <Button
            className="w-full"
            disabled={busy !== null}
            onClick={handleBrowserLogin}
          >
            {busy === "auth" ? spinner : <Globe size={16} />}
            Sign in with browser
          </Button>
        </div>
      );
    }

    const accountRow = (
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
            {status.email ?? "Signed in"}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {status.unlocked
              ? `Unlocked · synced version ${status.last_synced_version}`
              : status.vault_exists === false
                ? "No vault yet"
                : "Vault locked"}
          </div>
        </div>
        <Button variant="secondary" disabled={busy !== null} onClick={handleLogout}>
          <LogOut size={14} />
          Log out
        </Button>
      </div>
    );

    if (status.vault_exists === false) {
      return (
        <div className="space-y-3">
          {accountRow}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Choose a master passphrase. It encrypts everything on your device before upload —
            it is never sent to the server and cannot be reset. You will get a one-time recovery key.
          </p>
          <input
            className={inputClass}
            style={inputStyle}
            type="password"
            placeholder="Master passphrase (min. 8 characters)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
          />
          <input
            className={inputClass}
            style={inputStyle}
            type="password"
            placeholder="Confirm passphrase"
            value={passphraseConfirm}
            onChange={(e) => setPassphraseConfirm(e.target.value)}
            autoComplete="new-password"
          />
          <Button
            className="w-full"
            disabled={busy !== null || !passphrase || !passphraseConfirm}
            onClick={handleSetup}
          >
            {busy === "setup" ? spinner : <Lock size={16} />}
            Create encrypted vault
          </Button>
        </div>
      );
    }

    if (!status.unlocked) {
      return (
        <div className="space-y-3">
          {accountRow}
          <input
            className={inputClass}
            style={inputStyle}
            type={useRecovery ? "text" : "password"}
            placeholder={useRecovery ? "Recovery key (AZLA-...)" : "Master passphrase"}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && passphrase) void handleUnlock();
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy !== null || !passphrase} onClick={handleUnlock}>
              {busy === "unlock" ? spinner : <KeyRound size={16} />}
              Unlock vault
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                setUseRecovery((v) => !v);
                setPassphrase("");
              }}
            >
              {useRecovery ? "Use passphrase" : "Use recovery key"}
            </Button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Unlocking only decrypts the cloud vault key. Your local hosts and keys stay
            untouched until you choose what to sync.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {accountRow}
        <Button className="w-full" disabled={busy !== null} onClick={handleSync}>
          {busy === "sync" ? spinner : <RefreshCw size={16} />}
          Check for changes
        </Button>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Sync always shows what would change before anything is uploaded or downloaded.
        </p>
      </div>
    );
  };

  return (
    <section className="mb-10">
      <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
        Account &amp; Sync
      </h3>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        End-to-end encrypted sync of hosts, keys, snippets, and settings across devices.
      </p>
      <div
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        {status?.configured && (
          <SettingToggle
            label="Auto-sync on startup"
            description="When signed in, ask for your master passphrase at launch and review pending sync changes."
            checked={autoSync}
            onChange={(enabled) => {
              setAutoSync(enabled);
              setStoredAutoSync(enabled);
            }}
          />
        )}
        {renderBody()}
        {error && (
          <p className="break-words text-xs" style={{ color: "var(--danger, #f87171)" }}>
            {error.replace(/^Error:\s*/, "")}
          </p>
        )}
        {notice && !error && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {notice}
          </p>
        )}
      </div>

      {preview && (
        <SyncResolutionDialog
          preview={preview}
          busy={busy === "sync"}
          onApply={(resolution) => void handleApplyPreview(resolution)}
          onSkip={() => setPreview(null)}
        />
      )}

      {recoveryKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="w-full max-w-md rounded-xl border p-5"
            style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
          >
            <h4 className="mb-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
              Save your recovery key
            </h4>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              This is the only way to recover your vault if you forget the master passphrase.
              It is shown once — store it somewhere safe.
            </p>
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
              <Button variant="secondary" onClick={copyRecovery}>
                {recoveryCopied ? <Check size={14} /> : <Copy size={14} />}
                {recoveryCopied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setRecoveryKey(null)}>I saved it</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
