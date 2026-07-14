import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "./ui/Button";
import { checkForUpdate, installUpdate } from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";

export function UpdateSection() {
  const [appVersion, setAppVersion] = useState("…");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);

  const loadVersion = useCallback(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  useEffect(() => {
    loadVersion();
  }, [loadVersion]);

  const runCheck = useCallback(async (silent = false) => {
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
  }, []);

  useEffect(() => {
    void runCheck(true);
  }, [runCheck]);

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
    <section className="mb-10">
      <h3 className="mb-1 text-sm font-medium" style={{ color: "var(--text)" }}>
        Updates
      </h3>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Installed version {appVersion}. Release builds check azalea-web and GitHub for signed
        updates.
      </p>

      <div
        className="rounded-xl border px-4 py-3"
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
    </section>
  );
}
