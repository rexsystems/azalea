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

export function WorkspacesSection({ workspaces, canSave, busy, error, onSave, onOpen, onRename, onDelete }: Props) {
  return (
    <section className="mb-5 rounded-2xl border p-5 sm:p-6" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }} aria-label="Saved workspaces" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>Workspaces</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Save open tabs and split views on this device.</p>
        </div>
        <Button variant="secondary" disabled={!canSave || busy} onClick={onSave}>Save current tabs</Button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--text)" }}>{error}</p>}
      {busy && <p role="status" className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>Opening workspace…</p>}
      {workspaces.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>No saved workspaces. Open some sessions, then save your tabs here.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border-subtle)" }}>
              <div className="min-w-0 flex-1 basis-40">
                <p className="break-words text-sm font-medium" style={{ color: "var(--text)" }}>{workspace.name}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{workspace.tabs.length} {workspace.tabs.length === 1 ? "tab" : "tabs"}</p>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onOpen(workspace)} aria-label={`Open ${workspace.name}`}>Open</Button>
              <Button variant="ghost" disabled={busy} onClick={() => onRename(workspace)} aria-label={`Rename ${workspace.name}`}>Rename</Button>
              <Button variant="ghost" disabled={busy} onClick={() => onDelete(workspace)} aria-label={`Delete ${workspace.name}`}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
