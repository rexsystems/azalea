import type { SavedWorkspace } from "../lib/workspaces";
import { Button } from "./ui/Button";

interface Props {
  workspaces: SavedWorkspace[];
  canSave: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onOpen: (workspace: SavedWorkspace) => void;
  onRename: (workspace: SavedWorkspace) => void;
  onDelete: (workspace: SavedWorkspace) => void;
}

export function WorkspacesSection({
  workspaces,
  canSave,
  busy,
  error,
  onSave,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  return (
    <section className="mb-6" aria-label="Saved workspaces" aria-busy={busy}>
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Workspaces
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canSave || busy}
          onClick={onSave}
          title="Save open tabs and split views on this device"
        >
          Save current tabs
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-2 px-1 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="mb-2 px-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Opening workspace…
        </p>
      )}
      {workspaces.length === 0 ? (
        <p className="px-1 text-sm" style={{ color: "var(--text-muted)" }}>
          No saved workspaces. Open some sessions, then save your tabs here.
        </p>
      ) : (
        <ul
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          {workspaces.map((workspace, index) => (
            <li
              key={workspace.id}
              className="flex flex-wrap items-center gap-2 px-3.5 py-2.5"
              style={index > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined}
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="break-words text-sm font-medium" style={{ color: "var(--text)" }}>
                  {workspace.name}
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {workspace.tabs.length} {workspace.tabs.length === 1 ? "tab" : "tabs"}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onOpen(workspace)}
                aria-label={`Open ${workspace.name}`}
              >
                Open
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onRename(workspace)}
                aria-label={`Rename ${workspace.name}`}
              >
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onDelete(workspace)}
                aria-label={`Delete ${workspace.name}`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
