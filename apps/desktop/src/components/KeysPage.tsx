import { useState } from "react";
import type { SshKey } from "@azalea/shared";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { KeyRound, Plus, Trash2, Upload } from "lucide-react";
import * as api from "../lib/api";
import { filenameToKeyName } from "../lib/utils";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface KeysPageProps {
  keys: SshKey[];
  onGenerate: (name: string) => Promise<void>;
  onImport: (name: string, pem: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function KeysPage({ keys, onGenerate, onImport, onDelete }: KeysPageProps) {
  const [newKeyName, setNewKeyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    const name = newKeyName.trim() || "My Key";
    try {
      setBusy(true);
      setError(null);
      await onGenerate(name);
      setNewKeyName("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    const selected = await openFileDialog({ multiple: false });
    if (!selected || typeof selected !== "string") return;

    const derivedName = filenameToKeyName(selected);
    const name = newKeyName.trim() || derivedName;

    try {
      setBusy(true);
      setError(null);
      const pem = await api.readTextFile(selected);
      await onImport(name, pem);
      setNewKeyName("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      <div
        className="flex shrink-0 items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <h2 className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Keychain
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-lg space-y-5">
          <Input
            label="Key name (optional for import)"
            placeholder="My Laptop — or leave empty to use filename"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />

          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => void handleGenerate()}>
              <Plus size={16} />
              Generate
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() => void handleImport()}
            >
              <Upload size={16} />
              Import file
            </Button>
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Works with any private key file — including extensionless keys like id_rsa or id_ed25519.
          </p>

          <div className="space-y-2">
            {keys.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No keys yet.
              </p>
            ) : (
              keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center gap-3 rounded-xl border p-4"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-subtle)",
                  }}
                >
                  <div
                    className="rounded-lg p-2.5"
                    style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                  >
                    <KeyRound size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium" style={{ color: "var(--text)" }}>
                      {key.name}
                    </div>
                    <div className="text-xs uppercase" style={{ color: "var(--text-muted)" }}>
                      {key.key_type}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="!p-2"
                    style={{ color: "#f87171" }}
                    onClick={() => void onDelete(key.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
