import { useState } from "react";
import type { CreateKeyInput, Host, SshKey } from "@azalea/shared";
import {
  Check,
  Copy,
  FileKey,
  FileKey2,
  Fingerprint,
  HardDriveUpload,
  KeyRound,
  Trash2,
} from "lucide-react";
import * as api from "../lib/api";
import { copyText } from "../lib/clipboard";
import { filenameToKeyName } from "../lib/utils";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { SelectHostDialog, type SelectHostResult } from "./ui/SelectHostDialog";

interface KeysPageProps {
  keys: SshKey[];
  hosts: Host[];
  onGenerate: (input: CreateKeyInput) => Promise<void>;
  onImport: (name: string, pem: string, passphrase?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const ALGORITHM_OPTIONS = [
  { value: "ed25519", label: "Ed25519 (recommended)" },
  { value: "rsa", label: "RSA 4096" },
  { value: "ecdsa-p256", label: "ECDSA P-256" },
  { value: "ecdsa-p384", label: "ECDSA P-384" },
  { value: "ecdsa-p521", label: "ECDSA P-521" },
];

function formatKeyType(type: string): string {
  switch (type) {
    case "ed25519":
      return "Ed25519";
    case "rsa":
      return "RSA";
    case "ecdsa-nistp256":
      return "ECDSA P-256";
    case "ecdsa-nistp384":
      return "ECDSA P-384";
    case "ecdsa-nistp521":
      return "ECDSA P-521";
    case "dsa":
      return "DSA";
    default:
      return type;
  }
}

export function KeysPage({ keys, hosts, onGenerate, onImport, onDelete }: KeysPageProps) {
  const [newKeyName, setNewKeyName] = useState("");
  const [algorithm, setAlgorithm] = useState<string>("ed25519");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ name: string; pem: string } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [installKeyId, setInstallKeyId] = useState<string | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState<SelectHostResult | null>(null);

  const handleGenerate = async () => {
    const name = newKeyName.trim() || "My Key";
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      await onGenerate({
        name,
        algorithm: algorithm as CreateKeyInput["algorithm"],
      });
      setNewKeyName("");
      setNotice(`Generated ${ALGORITHM_OPTIONS.find((o) => o.value === algorithm)?.label ?? algorithm} key.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const finishImport = async (name: string, pem: string, phrase?: string) => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      await onImport(name, pem, phrase);
      setNewKeyName("");
      setPendingImport(null);
      setPassphrase("");
      setNotice("Key imported.");
    } catch (err) {
      const msg = String(err);
      if (msg.includes("KEY_NEEDS_PASSPHRASE")) {
        setPendingImport({ name, pem });
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    let picked: api.PickedTextFile | null = null;
    try {
      picked = await api.pickTextFile([{ name: "Private key", extensions: ["*"] }]);
    } catch (err) {
      setError(String(err));
      return;
    }
    if (!picked) return;

    const name = newKeyName.trim() || filenameToKeyName(picked.path);

    try {
      setBusy(true);
      setError(null);
      const pem = picked.contents;
      setBusy(false);
      await finishImport(name, pem);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const copyPublicKey = async (key: SshKey) => {
    try {
      await copyText(key.public_key.trim() + "\n");
      setCopiedId(key.id);
      setTimeout(() => setCopiedId((id) => (id === key.id ? null : id)), 1500);
    } catch (err) {
      setError(String(err));
    }
  };

  const exportPublicKey = async (key: SshKey) => {
    try {
      setBusy(true);
      setError(null);
      const path = await api.saveTextFile(
        `${key.name.replace(/[^\w.-]+/g, "_")}.pub`,
        [{ name: "Public key", extensions: ["pub"] }],
        `${key.public_key.trim()}\n`,
      );
      if (path) setNotice(`Saved public key to ${path}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const closeInstallDialog = () => {
    if (installBusy) return;
    setInstallKeyId(null);
    setInstallResult(null);
  };

  const installToHost = async (host: Host) => {
    if (!installKeyId || installBusy) return;
    try {
      setInstallBusy(true);
      setInstallResult(null);
      setError(null);
      setNotice(null);
      const result = await api.installPublicKey(installKeyId, host.id);
      setInstallResult({ ok: true, message: result.message });
      setNotice(result.message);
    } catch (err) {
      const message = String(err).replace(/^Error:\s*/, "");
      setInstallResult({ ok: false, message });
      setError(message);
    } finally {
      setInstallBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <div
        className="flex shrink-0 items-center gap-3 border-b px-5 py-3.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-panel)",
        }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
          aria-hidden
        >
          <KeyRound size={16} />
        </div>
        <div>
          <h2 className="text-sm font-medium" style={{ color: "var(--text)" }}>
            Keychain
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Generate, import, and install SSH identities
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-md space-y-4">
          <div
            className="space-y-3 rounded-lg border p-3.5"
            style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
          >
            <Input
              label="Key name (optional for import)"
              placeholder="My Laptop — or leave empty to use filename"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />

            <Select
              label="Generate algorithm"
              value={algorithm}
              options={ALGORITHM_OPTIONS}
              onChange={setAlgorithm}
            />

            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={() => void handleGenerate()}>
                <Fingerprint size={16} />
                Generate
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busy}
                onClick={() => void handleImport()}
              >
                <FileKey size={16} />
                Import file
              </Button>
            </div>

            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              OpenSSH / PKCS#1 / PKCS#8: Ed25519, RSA, ECDSA, DSA. Passphrases supported. Export
              .pub or append to a host&apos;s authorized_keys.
            </p>
          </div>

          {notice && !error && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {notice}
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}

          {pendingImport && (
            <div
              className="space-y-2 rounded-xl border p-4"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
            >
              <p className="text-sm" style={{ color: "var(--text)" }}>
                <span className="font-medium">{pendingImport.name}</span> is protected by a
                passphrase.
              </p>
              <Input
                type="password"
                placeholder="Passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && passphrase) {
                    void finishImport(pendingImport.name, pendingImport.pem, passphrase);
                  }
                }}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy || !passphrase}
                  onClick={() =>
                    void finishImport(pendingImport.name, pendingImport.pem, passphrase)
                  }
                >
                  Unlock & import
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setPendingImport(null);
                    setPassphrase("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {keys.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No keys yet.
              </p>
            ) : (
              keys.map((key) => (
                <div
                  key={key.id}
                  className="space-y-3 rounded-xl border p-4"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="rounded-lg p-2"
                      style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                      aria-hidden
                    >
                      <Fingerprint size={16} />
                    </div>
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                        {key.name}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {formatKeyType(key.key_type)}
                      </div>
                      <p
                        className="mt-1 break-all font-mono text-[10px] leading-relaxed"
                        style={{ color: "var(--text-muted)" }}
                        title={key.fingerprint}
                      >
                        {key.fingerprint}
                      </p>
                      <p
                        className="mt-2 break-all font-mono text-[10px] leading-relaxed"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {key.public_key}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="!p-2"
                      style={{ color: "#f87171" }}
                      disabled={busy}
                      onClick={() => void onDelete(key.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void copyPublicKey(key)}
                    >
                      {copiedId === key.id ? <Check size={14} /> : <Copy size={14} />}
                      {copiedId === key.id ? "Copied" : "Copy public"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void exportPublicKey(key)}
                    >
                      <FileKey2 size={14} />
                      Export .pub
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || hosts.length === 0}
                      onClick={() => {
                        setInstallResult(null);
                        setInstallKeyId(key.id);
                      }}
                    >
                      <HardDriveUpload size={14} />
                      Add to host
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <SelectHostDialog
        open={Boolean(installKeyId)}
        title="Install public key on host"
        message="Connects with the host's saved password or key, then appends this public key to ~/.ssh/authorized_keys if it isn't already there."
        hosts={hosts}
        busy={installBusy}
        result={installResult}
        onSelect={(host) => void installToHost(host)}
        onCancel={closeInstallDialog}
      />
    </div>
  );
}
