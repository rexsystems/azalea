import { useEffect, useState } from "react";
import { SettingToggle } from "./ui/SettingToggle";
import {
  getSshConfigExport,
  setSshConfigExport,
  type SshConfigExportStatus,
} from "../lib/sshConfigExport";

const REFRESH_MS = 5000;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function SshConfigExportSection() {
  const [status, setStatus] = useState<SshConfigExportStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getSshConfigExport()
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err).replace(/^Error:\s*/, ""));
        });
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!status) {
    return error ? (
      <p className="break-words text-xs" style={{ color: "var(--danger)" }}>
        Could not read the ssh config export setting: {error}
      </p>
    ) : null;
  }

  const toggle = (enabled: boolean) => {
    setSaving(true);
    setError(null);
    setSshConfigExport(enabled)
      .then(setStatus)
      .catch((err) => setError(String(err).replace(/^Error:\s*/, "")))
      .finally(() => setSaving(false));
  };

  const problem = error ?? status.lastError;

  return (
    <div className="space-y-3 border-t pt-5" style={{ borderColor: "var(--border-subtle)" }}>
      <div>
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Use these hosts in VS Code
        </div>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          VS Code Remote-SSH and the ssh command read {status.configPath}. Azalea can keep its hosts
          there, inside a marked block at the top of the file. Your own lines outside the block are
          left alone, and a copy of the original file is saved as config.azalea-backup the first
          time.
        </p>
      </div>

      <SettingToggle
        label={`Keep ${status.configPath} in sync`}
        description="Changes in Azalea show up within a few seconds. Turning this off removes the block."
        checked={status.enabled}
        disabled={saving}
        onChange={toggle}
      />

      {status.enabled && (
        <div
          className="space-y-1.5 text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          <p>
            {plural(status.exportedHosts, "host", "hosts")} written to {status.configPath}.
            {status.skippedHosts > 0 &&
              ` ${plural(status.skippedHosts, "host was", "hosts were")} left out because the address or user name has spaces, quotes or # in it.`}
          </p>
          {status.agentSupported && status.agentSocket ? (
            <p>
              Key logins go through the Azalea agent at {status.agentSocket}, so private keys never
              leave Azalea. VS Code can use them only while Azalea is running; turn on Close to
              system tray in Appearance to keep it running in the background.
            </p>
          ) : (
            <p>
              On Windows the hosts are written without keys. VS Code will use the keys in your own
              .ssh folder, or ask for a password.
            </p>
          )}
          <p>Hosts that log in with a password get no key, so VS Code asks for the password.</p>
        </div>
      )}

      {problem && (
        <p className="break-words text-xs" style={{ color: "var(--danger)" }}>
          {problem}
        </p>
      )}
    </div>
  );
}
