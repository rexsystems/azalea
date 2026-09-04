import { useState } from "react";
import type { CreateKeyInput, Host, SshKey } from "@azalea/shared";
import {
  Check,
  Copy,
  FileKey,
  FileKey2,
  Fingerprint,
  HardDriveUpload,
  Trash2,
} from "./icons";
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

function shortFingerprint(fp: string): string {
  const clean = fp.replace(/^SHA256:/i, "").trim();
  if (clean.length <= 20) return fp;
  return `${clean.slice(0, 10)}…${clean.slice(-8)}`;
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
      setNotice(
        `Generated ${ALGORITHM_OPTIONS.find((o) => o.value === algorithm)?.label ?? algorithm} key.`,
      );
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
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell keys-shell flex h-full min-h-0 flex-1 flex-col !pb-0">
        <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
            >
              Keychain
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              {keys.length === 0
                ? "Generate, import, and install SSH identities"
                : `${keys.length} key${keys.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        <div
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-2xl border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <div className="space-y-8 p-5 pb-8 sm:p-6 sm:pb-10">
            <section>
              <div
                className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="min-w-0">
                  <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                    New key
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Create an Ed25519/RSA/ECDSA key or import an existing private key file.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
                <Input
                  label="Name"
                  placeholder="My Laptop — or leave empty to use filename"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
                <Select
                  label="Algorithm"
                  value={algorithm}
                  options={ALGORITHM_OPTIONS}
                  onChange={setAlgorithm}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void handleGenerate()}>
                  <Fingerprint size={16} />
                  Generate
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void handleImport()}
                >
                  <FileKey size={16} />
                  Import file
                </Button>
              </div>

              {(notice || error) && (
                <p
                  className="mt-4 text-sm"
                  style={{ color: error ? "#f87171" : "var(--text-muted)" }}
                >
                  {error ?? notice}
                </p>
              )}

              {pendingImport && (
                <div
                  className="mt-5 space-y-3 rounded-xl border p-4"
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
            </section>

            <section>
              <div
                className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div className="min-w-0">
                  <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                    Your keys
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Copy the public key, export a `.pub` file, or install it on a host.
                  </p>
                </div>
              </div>

              {keys.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    No keys yet
                  </p>
                  <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>
                    Generate a new identity above, or import an existing OpenSSH private key.
                  </p>
                </div>
              ) : (
                <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {keys.map((key) => {
                    const copied = copiedId === key.id;
                    return (
                      <article
                        key={key.id}
                        className="flex min-w-0 flex-col overflow-hidden rounded-xl border p-4"
                        style={{
                          background: "var(--bg-card)",
                          borderColor: "var(--border-subtle)",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div
                              className="truncate text-sm font-semibold"
                              style={{ color: "var(--text)" }}
                            >
                              {key.name}
                            </div>
                            <div
                              className="mt-1 flex flex-wrap items-center gap-2 text-[11px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              <span
                                className="rounded-md px-1.5 py-0.5 font-medium"
                                style={{
                                  background: "var(--accent-muted)",
                                  color: "var(--accent)",
                                }}
                              >
                                {formatKeyType(key.key_type)}
                              </span>
                              <span
                                className="font-mono"
                                title={key.fingerprint}
                              >
                                {shortFingerprint(key.fingerprint)}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="!p-2 shrink-0"
                            style={{ color: "#f87171" }}
                            disabled={busy}
                            onClick={() => void onDelete(key.id)}
                            title="Delete key"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>

                        <p
                          className="mt-3 line-clamp-2 overflow-hidden break-all font-mono text-[10px] leading-relaxed"
                          style={{ color: "var(--text-secondary)" }}
                          title={key.public_key}
                        >
                          {key.public_key}
                        </p>

                        <div
                          className="key-card-actions mt-auto flex flex-wrap gap-1.5 border-t pt-3"
                          style={{ borderColor: "var(--border-subtle)", marginTop: "1rem" }}
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void copyPublicKey(key)}
                          >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? "Copied" : "Copy"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => void exportPublicKey(key)}
                          >
                            <FileKey2 size={14} />
                            Export
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
                            Install
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
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
