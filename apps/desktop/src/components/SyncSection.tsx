import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { maskEmail } from "../lib/utils";
import { getStoredAutoSync, setStoredAutoSync } from "../lib/settings";
import { Button } from "./ui/Button";
import { PlanBadge } from "./PlanBadge";
import { SettingToggle } from "./ui/SettingToggle";
import { SyncResolutionDialog } from "./SyncResolutionDialog";

interface SyncSectionProps {
  status: api.SyncStatus | null;
  onStatusChange: (status: api.SyncStatus) => void;
  getSettings: () => unknown;
  onVaultApplied: (settings: unknown) => void;
  onDataRefresh: () => Promise<void>;
}

type Busy = null | "status" | "auth" | "setup" | "unlock" | "sync";

const WEB_PRICING_URL = "https://azalea.rexsystems.me/pricing";

const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm outline-none transition-ui";

const inputStyle = {
  background: "var(--bg-base)",
  borderColor: "var(--border-subtle)",
  color: "var(--text)",
} as const;

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function syncStateLabel(status: api.SyncStatus): string {
  if (status.storage_blocked) return "Storage full — upload blocked";
  if (!status.unlocked) return status.vault_exists === false ? "No cloud vault" : "Locked";
  if (
    status.remote_version != null &&
    status.remote_version > status.last_synced_version
  ) {
    return "Cloud has newer changes";
  }
  if (
    status.local_estimated_bytes != null &&
    status.cloud_used_bytes !== status.local_estimated_bytes
  ) {
    return "Local changes pending";
  }
  return "In sync";
}

function StoragePanel({ status }: { status: api.SyncStatus }) {
  const used = status.cloud_used_bytes;
  const limit = status.storage_limit_bytes;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div
      className="space-y-2 rounded-lg border p-3"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-base)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
          Cloud storage
        </span>
        <PlanBadge plan={status.plan} />
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: status.storage_blocked ? "#fbbf24" : "var(--accent)",
          }}
        />
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {fmtBytes(used)} / {fmtBytes(limit)} in cloud
      </p>
      {status.unlocked && status.local_estimated_bytes != null && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          This device (estimated): {fmtBytes(status.local_estimated_bytes)}
        </p>
      )}
      {status.storage_blocked && (
        <p className="text-xs" style={{ color: "#fbbf24" }}>
          Your vault is too large for the {status.plan === "pro" ? "Pro" : "Free"} plan. Remove
          hosts or keys locally, then sync again.
        </p>
      )}
      {status.plan !== "pro" && (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-xs transition-colors hover:opacity-80"
          style={{ color: "var(--accent)" }}
          onClick={() => void openUrl(WEB_PRICING_URL)}
        >
          Upgrade to Pro
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}

export function SyncSection({
  status,
  onStatusChange,
  getSettings,
  onVaultApplied,
  onDataRefresh,
}: SyncSectionProps) {
  const [busy, setBusy] = useState<Busy>(null);
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
      onStatusChange(await api.syncStatus());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }, [onStatusChange]);

  useEffect(() => {
    if (!status) {
      void refreshStatus();
    }
  }, [refreshStatus, status]);

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
    if (status?.storage_blocked) {
      setError(
        "Cloud vault is full. Remove hosts or keys locally, then try again, or upgrade to Pro.",
      );
      return;
    }
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
  }, [getSettings, status?.storage_blocked]);

  const run = useCallback(
    async (kind: Busy, action: () => Promise<void>) => {
      setBusy(kind);
      setError(null);
      setNotice(null);
      try {
        await action();
        onStatusChange(await api.syncStatus());
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
      setNotice("Vault unlocked.");
      await runPreview();
    });

  const handleSyncNow = () =>
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
      onStatusChange(await api.syncStatus());
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
          Cloud sync is not available in this build.
        </p>
      );
    }

    if (!status.logged_in) {
      return (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sign in through your browser to link this device. Account signup and password resets
            happen on the Azalea website.
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
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
              {status.email ? maskEmail(status.email) : "Signed in"}
            </div>
            <PlanBadge plan={status.plan} size="md" />
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {syncStateLabel(status)}
            {status.remote_version != null && (
              <span className="opacity-70">
                {" "}
                · cloud v{status.remote_version}
                {status.last_synced_version > 0 && ` · synced v${status.last_synced_version}`}
              </span>
            )}
          </div>
        </div>
        <Button variant="secondary" disabled={busy !== null} onClick={handleLogout}>
          <LogOut size={14} />
          Log out
        </Button>
      </div>
    );

    const storagePanel = <StoragePanel status={status} />;

    if (status.vault_exists === false) {
      return (
        <div className="space-y-3">
          {accountRow}
          {storagePanel}
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Choose a master passphrase. It encrypts everything before upload — never sent to the
            server. You will get a one-time recovery key.
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
          {storagePanel}
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
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {accountRow}
        {storagePanel}
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="w-full"
            disabled={busy !== null || status.storage_blocked}
            onClick={handleSyncNow}
          >
            {busy === "sync" ? spinner : <RefreshCw size={16} />}
            Sync now
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy !== null}
            onClick={() => void refreshStatus()}
          >
            {busy === "status" ? spinner : <RefreshCw size={16} />}
            Refresh status
          </Button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Sync shows what would change before anything is uploaded or downloaded. Local data is
          unlimited — only encrypted cloud storage counts toward your plan.
        </p>
      </div>
    );
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Account &amp; Sync
        </h3>
        {status?.logged_in && <PlanBadge plan={status.plan} size="md" />}
      </div>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Encrypted cloud backup for hosts, keys, and settings. Free includes sync — you only pay for
        more cloud space.
      </p>
      <div
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        {status?.configured && status.logged_in && (
          <SettingToggle
            label="Prompt for passphrase on startup"
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
              This is the only way to recover your vault if you forget the master passphrase. It is
              shown once — store it somewhere safe.
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
