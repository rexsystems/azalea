import type { HostGroup } from "@azalea/shared";
import { Folder, FolderX } from "lucide-react";
import { Button } from "./Button";

interface SelectGroupDialogProps {
  open: boolean;
  title?: string;
  message?: string;
  groups: HostGroup[];
  currentGroupId?: string | null;
  allowUngroup?: boolean;
  onSelect: (groupId: string | null) => void;
  onCancel: () => void;
}

export function SelectGroupDialog({
  open,
  title = "Add to group",
  message,
  groups,
  currentGroupId = null,
  allowUngroup = true,
  onSelect,
  onCancel,
}: SelectGroupDialogProps) {
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
          {title}
        </h3>
        {message && (
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>
        )}

        {groups.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
            No groups yet. Create one from the hosts page context menu.
          </p>
        ) : (
          <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {groups.map((group) => {
              const selected = group.id === currentGroupId;
              return (
                <button
                  key={group.id}
                  type="button"
                  disabled={selected}
                  onClick={() => onSelect(group.id)}
                  className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left disabled:opacity-55"
                  style={{
                    borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
                    background: selected ? "var(--accent-muted)" : "var(--bg-card)",
                  }}
                >
                  <Folder size={18} style={{ color: "var(--accent)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                      {group.name}
                    </div>
                    {selected && (
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Already in this group
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {allowUngroup && currentGroupId && (
            <Button variant="secondary" onClick={() => onSelect(null)}>
              <FolderX size={15} />
              Remove from group
            </Button>
          )}
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
