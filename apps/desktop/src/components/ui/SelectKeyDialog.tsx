import type { SshKey } from "@azalea/shared";
import { KeyRound } from "lucide-react";
import { Button } from "./Button";

interface SelectKeyDialogProps {
  open: boolean;
  hostName: string;
  keys: SshKey[];
  onSelect: (keyId: string) => void;
  onCancel: () => void;
}

export function SelectKeyDialog({
  open,
  hostName,
  keys,
  onSelect,
  onCancel,
}: SelectKeyDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Close"
        onClick={onCancel}
      />
      <div
        className="animate-menu-in relative w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        style={{
          background: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
          Choose SSH key
        </h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {hostName} has no key saved. Pick one to connect — it will be saved on this host.
        </p>

        {keys.length === 0 ? (
          <p className="mt-4 text-sm text-amber-200">
            No SSH keys in Keychain. Add a key first, then connect again.
          </p>
        ) : (
          <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {keys.map((key) => (
              <button
                key={key.id}
                type="button"
                onClick={() => onSelect(key.id)}
                className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "var(--bg-card)",
                }}
              >
                <KeyRound size={18} style={{ color: "var(--accent)" }} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                    {key.name}
                  </div>
                  <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {key.fingerprint}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
