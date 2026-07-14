import { Loader2, X } from "lucide-react";
import type { SyncPreview, VaultDiff } from "../lib/api";
import { Button } from "./ui/Button";

interface SyncResolutionDialogProps {
  preview: SyncPreview;
  busy: boolean;
  onApply: (resolution?: "keep_local" | "keep_cloud") => void;
  onSkip: () => void;
}

function onlyAddedModified(diff: VaultDiff): VaultDiff {
  return {
    hosts: { ...diff.hosts, removed: [] },
    keys: { ...diff.keys, removed: [] },
    groups: { ...diff.groups, removed: [] },
  };
}

function onlyRemoved(diff: VaultDiff): VaultDiff {
  return {
    hosts: { added: [], modified: [], removed: diff.hosts.removed },
    keys: { added: [], modified: [], removed: diff.keys.removed },
    groups: { added: [], modified: [], removed: diff.groups.removed },
  };
}

function hasDiffItems(diff: VaultDiff): boolean {
  for (const section of [diff.hosts, diff.keys, diff.groups]) {
    if (
      section.added.length > 0 ||
      section.removed.length > 0 ||
      section.modified.length > 0
    ) {
      return true;
    }
  }
  return false;
}

function DiffList({ title, diff }: { title: string; diff: VaultDiff }) {
  const sections: { label: string; items: string[] }[] = [
    { label: "Hosts added", items: diff.hosts.added },
    { label: "Hosts removed", items: diff.hosts.removed },
    { label: "Hosts changed", items: diff.hosts.modified },
    { label: "Keys added", items: diff.keys.added },
    { label: "Keys removed", items: diff.keys.removed },
    { label: "Keys changed", items: diff.keys.modified },
    { label: "Groups added", items: diff.groups.added },
    { label: "Groups removed", items: diff.groups.removed },
    { label: "Groups changed", items: diff.groups.modified },
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
        {title}
      </p>
      <div
        className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-2 text-xs"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        {sections.map((section) => (
          <div key={section.label}>
            <div className="mb-1 font-medium" style={{ color: "var(--text)" }}>
              {section.label}
            </div>
            <ul className="list-inside list-disc space-y-0.5">
              {section.items.map((item) => (
                <li key={`${section.label}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function dialogCopy(preview: SyncPreview): {
  title: string;
  description: string;
  primaryLabel: string;
  primaryResolution?: "keep_local" | "keep_cloud";
  showSecondary?: boolean;
  secondaryLabel?: string;
  secondaryResolution?: "keep_local" | "keep_cloud";
} {
  switch (preview.status) {
    case "push":
      return {
        title: "Upload local changes?",
        description:
          "This device has changes that are not in the cloud yet. Review them before uploading.",
        primaryLabel: "Upload to cloud",
      };
    case "pull":
      return {
        title: "Download cloud changes?",
        description:
          "The cloud vault is newer than what this device last synced. Review what would change here before downloading.",
        primaryLabel: "Use cloud vault",
        primaryResolution: "keep_cloud",
      };
    case "conflict":
      return {
        title: "Sync conflict",
        description:
          "Both this device and the cloud changed since the last sync. Choose which version to keep — the other side will be overwritten.",
        primaryLabel: "Keep this device",
        primaryResolution: "keep_local",
        showSecondary: true,
        secondaryLabel: "Use cloud vault",
        secondaryResolution: "keep_cloud",
      };
    default:
      return {
        title: "Sync",
        description: "",
        primaryLabel: "Continue",
      };
  }
}

export function SyncResolutionDialog({
  preview,
  busy,
  onApply,
  onSkip,
}: SyncResolutionDialogProps) {
  if (preview.status === "in_sync" || preview.status === "needs_setup" || preview.status === "locked") {
    return null;
  }

  const copy = dialogCopy(preview);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <div
        className="w-full max-w-lg rounded-xl border p-5"
        style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {copy.title}
            </h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {copy.description}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1"
            style={{ color: "var(--text-muted)" }}
            onClick={onSkip}
            aria-label="Skip sync"
          >
            <X size={16} />
          </button>
        </div>

        {preview.status === "push" && (
          <div className="space-y-3">
            <DiffList title="New on this device" diff={onlyAddedModified(preview.local)} />
            {hasDiffItems(onlyRemoved(preview.local)) && (
              <DiffList
                title="Only in cloud (removed if you upload)"
                diff={onlyRemoved(preview.local)}
              />
            )}
          </div>
        )}
        {preview.status === "pull" && (
          <DiffList title="In the cloud" diff={onlyAddedModified(preview.remote)} />
        )}
        {preview.status === "conflict" && (
          <div className="space-y-3">
            <DiffList title="Only on this device" diff={onlyAddedModified(preview.local)} />
            <DiffList title="Only in the cloud" diff={onlyAddedModified(preview.remote)} />
          </div>
        )}

        <div className={`mt-4 grid gap-2 ${copy.showSecondary ? "grid-cols-2" : "grid-cols-1"}`}>
          <Button
            disabled={busy}
            onClick={() => onApply(copy.primaryResolution)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : copy.primaryLabel}
          </Button>
          {copy.showSecondary && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => onApply(copy.secondaryResolution)}
            >
              {copy.secondaryLabel}
            </Button>
          )}
        </div>

        <button
          type="button"
          className="mt-4 w-full text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)" }}
          disabled={busy}
          onClick={onSkip}
        >
          Skip for now — keep working locally
        </button>
      </div>
    </div>
  );
}
