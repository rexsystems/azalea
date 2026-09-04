import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "./ui/Button";
import { checkForUpdate, installUpdate, isUpdaterSupported } from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { isMobileRuntime } from "../hooks/useIsMobile";

export function UpdateSection() {
  const [appVersion, setAppVersion] = useState("…");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const mobile = isMobileRuntime();
  const supported = isUpdaterSupported();

  const loadVersion = useCallback(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  const runCheck = useCallback(
    async (silent = false) => {
      if (!supported) return null;

      setBusy(true);
      if (!silent) {
        setError(null);
        setStatus("Checking for updates…");
        setPendingVersion(null);
        setPendingUpdate(null);
      }

      try {
        const result = await checkForUpdate();

        if (result.status === "unavailable") {
          if (!silent) {
            setError(result.message);
            setStatus(null);
          }
          return result;
        }

        if (result.status === "current") {
          if (!silent) setStatus("You're on the latest version.");
          return result;
        }

        setPendingUpdate(result.update);
        setPendingVersion(result.version);
        setStatus(`Azalea ${result.version} is available.`);
        return result;
      } catch (err) {
        if (!silent) {
          setError(String(err));
          setStatus(null);
        }
        return null;
      } finally {
        setBusy(false);
      }
    },
    [supported],
  );

  useEffect(() => {
    if (!supported) return;
    void runCheck(true);
  }, [runCheck, supported]);

  const handleCheck = useCallback(() => runCheck(false), [runCheck]);

  const handleInstall = useCallback(async () => {
    if (!pendingUpdate || !pendingVersion) return;
    setBusy(true);
    setError(null);
    setStatus("Downloading update…");

    try {
      await installUpdate(pendingUpdate);
    } catch (err) {
      setError(String(err));
      setStatus(null);
      setBusy(false);
    }
  }, [pendingUpdate, pendingVersion]);

  return (
    <section className="settings-section">
      <div className="mb-3 flex items-start gap-3">
        <div className="settings-section-icon" aria-hidden>
          <RefreshCw size={16} />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Updates
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {mobile
              ? `Installed version ${appVersion}. Mobile builds are updated by installing a new APK.`
              : `Installed version ${appVersion}. Release builds check azalea.rexsystems.me and GitHub for signed updates.`}
          </p>
        </div>
      </div>

      {!mobile && (
        <div
          className="rounded-lg border px-3 py-2.5"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void handleCheck()}>
              {busy && !pendingVersion ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Check for updates
            </Button>

            {pendingVersion && (
              <Button disabled={busy} onClick={() => void handleInstall()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Install {pendingVersion}
              </Button>
            )}
          </div>

          {status && (
            <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
              {status}
            </p>
          )}
          {error && (
            <p className="mt-3 text-xs" style={{ color: "#f87171" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
