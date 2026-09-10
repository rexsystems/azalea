import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Folder, KeyRound, Loader2, Server, Upload } from "./icons";
import * as api from "../lib/api";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";

interface ImportSectionProps {
  busy?: boolean;
  onImportBackup: () => void;
  onImportBackupReplace: () => void;
  onDataChanged: () => Promise<void>;
}

function ScrollCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative isolate overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <div
        className="import-scroll max-h-48 space-y-0.5 overflow-y-auto overflow-x-hidden py-2 pl-2 pr-1.5"
        style={{ scrollbarGutter: "stable" }}
      >
        {children}
      </div>
    </div>
  );
}

export function ImportSection({
  busy = false,
  onImportBackup,
  onImportBackupReplace,
  onDataChanged,
}: ImportSectionProps) {
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scan, setScan] = useState<api.SshDirScanResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set());
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hostKey = (h: api.SshDirHostCandidate) =>
    `${h.name}|${h.hostname}|${h.port}|${h.username}`;

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.scanSshDir();
      setScan(result);
      setSelectedKeys(
        new Set(result.keys.filter((k) => !k.already_imported).map((k) => k.path)),
      );
      setSelectedHosts(
        new Set(
          result.hosts.filter((h) => !h.already_imported).map((h) => hostKey(h)),
        ),
      );
      if (!result.exists) {
        setNotice(`No .ssh folder at ${result.ssh_dir}`);
      } else if (result.keys.length === 0 && result.hosts.length === 0) {
        setNotice(`Scanned ${result.ssh_dir}. No private keys or Host entries found.`);
      }
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setScan(null);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const needsPassphrase = useMemo(
    () => Boolean(scan?.keys.some((k) => selectedKeys.has(k.path) && k.encrypted)),
    [scan, selectedKeys],
  );

  const toggleKey = (path: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleHost = (key: string) => {
    setSelectedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runImport = async () => {
    if (!scan) return;
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const hosts = scan.hosts.filter((h) => selectedHosts.has(hostKey(h)));
      const result = await api.importSshDir({
        key_paths: [...selectedKeys],
        hosts,
        passphrase: passphrase.trim() ? passphrase : null,
      });
      await onDataChanged();
      await runScan();
      const failNote =
        result.keys_failed.length > 0
          ? ` Failed: ${result.keys_failed.slice(0, 3).join("; ")}${
              result.keys_failed.length > 3 ? "…" : ""
            }`
          : "";
      setNotice(
        `Imported ${result.keys_imported} key(s), ${result.hosts_imported} host(s). Skipped ${result.keys_skipped} key(s), ${result.hosts_skipped} host(s).${failNote}`,
      );
      setPassphrase("");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setImporting(false);
    }
  };

  const disabled = busy || scanning || importing;
  const canImport = selectedKeys.size > 0 || selectedHosts.size > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              OpenSSH (~/.ssh)
            </div>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Detect private keys and Host entries from your SSH config, then import what you want.
            </p>
          </div>
          <Button variant="secondary" disabled={disabled} onClick={() => void runScan()}>
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <Folder size={14} />}
            Rescan
          </Button>
        </div>

        {scan && (
          <p className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {scan.ssh_dir}
          </p>
        )}

        {scan && scan.keys.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text)" }}>
              <KeyRound size={14} />
              Keys ({scan.keys.length})
            </div>
            <ScrollCard>
              {scan.keys.map((key) => {
                const checked = selectedKeys.has(key.path);
                const rowDisabled = key.already_imported || disabled;
                return (
                  <Checkbox
                    key={key.path}
                    className="rounded-lg px-2 py-1.5 hover-subtle"
                    label={`${key.name}${key.already_imported ? " (already imported)" : ""}${
                      key.encrypted ? " (encrypted)" : ""
                    }`}
                    description={
                      [key.key_type, key.fingerprint].filter(Boolean).join(" · ") || key.path
                    }
                    checked={checked}
                    disabled={rowDisabled}
                    onChange={() => toggleKey(key.path)}
                  />
                );
              })}
            </ScrollCard>
          </div>
        )}

        {scan && scan.hosts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--text)" }}>
              <Server size={14} />
              Config hosts ({scan.hosts.length})
            </div>
            <ScrollCard>
              {scan.hosts.map((host) => {
                const key = hostKey(host);
                const checked = selectedHosts.has(key);
                const rowDisabled = host.already_imported || disabled;
                return (
                  <Checkbox
                    key={key}
                    className="rounded-lg px-2 py-1.5 hover-subtle"
                    label={`${host.name}${host.already_imported ? " (already imported)" : ""}`}
                    description={`${host.username}@${host.hostname}:${host.port}${
                      host.identity_file ? ` · ${host.identity_file}` : ""
                    }`}
                    checked={checked}
                    disabled={rowDisabled}
                    onChange={() => toggleHost(key)}
                  />
                );
              })}
            </ScrollCard>
          </div>
        )}

        {needsPassphrase && (
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-base)",
              borderColor: "var(--border-subtle)",
              color: "var(--text)",
            }}
            type="password"
            placeholder="Passphrase for encrypted keys"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={disabled}
          />
        )}

        <Button
          className="w-full"
          disabled={disabled || !canImport || (needsPassphrase && !passphrase.trim())}
          onClick={() => void runImport()}
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Import selected
        </Button>
      </div>

      <div className="space-y-2 border-t pt-5" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Azalea backup / other files
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Import an Azalea backup JSON, OpenSSH config, or other supported host export.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={disabled} onClick={onImportBackup}>
            <Upload size={16} />
            Import file
          </Button>
          <Button variant="danger" disabled={disabled} onClick={onImportBackupReplace}>
            Replace &amp; import
          </Button>
        </div>
      </div>

      {error && (
        <p className="break-words text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="break-words text-xs" style={{ color: "var(--text-secondary)" }}>
          {notice}
        </p>
      )}
    </div>
  );
}
