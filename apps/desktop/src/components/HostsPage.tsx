import { useEffect, useMemo, useState } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import {
  Check,
  Folder,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  SquareTerminal,
  Tag,
  Trash2,
  X,
  Zap,
} from "./icons";
import { groupHostsByGroup } from "../lib/utils";
import { EmptyHostsState, GroupSection } from "./HostTile";
import { useContextMenu } from "./ui/ContextMenu";
import { SelectGroupDialog } from "./ui/SelectGroupDialog";
import { SkeletonCard } from "./ui/Skeleton";

interface HostsPageProps {
  hosts: Host[];
  groups: HostGroup[];
  connectingHostId: string | null;
  loading?: boolean;
  onConnect: (host: Host) => void;
  onWakeHost: (host: Host) => void;
  onAddServer: (groupId?: string | null) => void;
  onAddGroup: () => void;
  onEditHost: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  onDeleteHosts: (hosts: Host[]) => void;
  onRenameGroup: (group: HostGroup) => void;
  onDeleteGroup: (group: HostGroup) => void;
  onMoveHost: (hostId: string, groupId: string | null) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onQuickConnect: () => void;
  onOpenLocalTerminal: () => void;
  isMobile?: boolean;
}

export function HostsPage({
  hosts,
  groups,
  connectingHostId,
  loading = false,
  onConnect,
  onWakeHost,
  onAddServer,
  onAddGroup,
  onEditHost,
  onDeleteHost,
  onDeleteHosts,
  onRenameGroup,
  onDeleteGroup,
  onMoveHost,
  searchQuery,
  onSearchChange,
  onQuickConnect,
  onOpenLocalTerminal,
  isMobile = false,
}: HostsPageProps) {
  const { openMenu, menuElement } = useContextMenu();
  const [groupPickHost, setGroupPickHost] = useState<Host | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filteredHosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.hostname.toLowerCase().includes(q) ||
        h.username.toLowerCase().includes(q),
    );
  }, [hosts, searchQuery]);

  const grouped = useMemo(
    () => groupHostsByGroup(filteredHosts, groups),
    [filteredHosts, groups],
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(hosts.map((h) => h.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [hosts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "Escape" && selectedIds.size > 0) {
        setSelectedIds(new Set());
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
        e.preventDefault();
        setSelectedIds(new Set(filteredHosts.map((h) => h.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.size, filteredHosts]);

  const toggleSelect = (host: Host) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(host.id)) next.delete(host.id);
      else next.add(host.id);
      return next;
    });
  };

  const selectAllFiltered = () => setSelectedIds(new Set(filteredHosts.map((h) => h.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const selectedHosts = useMemo(
    () => hosts.filter((h) => selectedIds.has(h.id)),
    [hosts, selectedIds],
  );

  const hostMenu = (host: Host) => {
    const isSelected = selectedIds.has(host.id);
    return [
      {
        items: [
          {
            id: "connect",
            label: "Connect",
            icon: <Play size={16} />,
            onClick: () => onConnect(host),
          },
          ...(!isMobile && host.mac_address
            ? [
                {
                  id: "wake",
                  label: "Wake up",
                  icon: <Zap size={16} />,
                  onClick: () => onWakeHost(host),
                },
              ]
            : []),
          {
            id: "edit",
            label: "Edit",
            icon: <Pencil size={16} />,
            onClick: () => onEditHost(host),
          },
          {
            id: "select",
            label: isSelected ? "Deselect" : "Select",
            icon: <Check size={16} />,
            onClick: () => toggleSelect(host),
          },
          {
            id: "add-to-group",
            label: host.group_id ? "Move to group…" : "Add to group…",
            icon: <Tag size={16} />,
            onClick: () => setGroupPickHost(host),
          },
        ],
      },
      {
        items: [
          {
            id: "delete",
            label: "Delete",
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => onDeleteHost(host),
          },
        ],
      },
    ];
  };

  const groupMenu = (group: HostGroup | null) => {
    if (!group) {
      return [
        {
          items: [
            {
              id: "add",
              label: "Add server",
              icon: <Server size={16} />,
              onClick: () => onAddServer(null),
            },
          ],
        },
      ];
    }
    return [
      {
        items: [
          {
            id: "add",
            label: "Add server",
            icon: <Server size={16} />,
            onClick: () => onAddServer(group.id),
          },
          {
            id: "rename",
            label: "Rename",
            icon: <Pencil size={16} />,
            onClick: () => onRenameGroup(group),
          },
        ],
      },
      {
        items: [
          {
            id: "del",
            label: "Delete group",
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () => onDeleteGroup(group),
          },
        ],
      },
    ];
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("[data-host-tile]")) return;
        openMenu(e, [
          {
            items: [
              {
                id: "add-server",
                label: "New Host",
                icon: <Server size={16} />,
                onClick: () => onAddServer(),
              },
              {
                id: "add-group",
                label: "New Group",
                icon: <Folder size={16} />,
                onClick: onAddGroup,
              },
            ],
          },
        ]);
      }}
    >
      {menuElement}

      <SelectGroupDialog
        open={Boolean(groupPickHost)}
        title={groupPickHost?.group_id ? "Move to group" : "Add to group"}
        message={groupPickHost ? `Choose a group for ${groupPickHost.name}.` : undefined}
        groups={groups}
        currentGroupId={groupPickHost?.group_id ?? null}
        allowUngroup={Boolean(groupPickHost?.group_id)}
        onSelect={(groupId) => {
          if (!groupPickHost) return;
          onMoveHost(groupPickHost.id, groupId);
          setGroupPickHost(null);
        }}
        onCancel={() => setGroupPickHost(null)}
      />

      <div className="settings-shell flex min-h-0 flex-1 flex-col !pb-0">
        <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
            >
              Hosts
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              {hosts.length === 0
                ? "Hosts, groups, and local sessions"
                : `${hosts.length} host${hosts.length === 1 ? "" : "s"}${
                    groups.length > 0
                      ? ` · ${groups.length} group${groups.length === 1 ? "" : "s"}`
                      : ""
                  }`}
            </p>
          </div>
          {!isMobile && (
            <button
              type="button"
              onClick={onAddGroup}
              className="hover-subtle inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              <Folder size={15} />
              New group
            </button>
          )}
        </div>

        <div
          className="mb-4 flex shrink-0 flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center sm:p-3.5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onQuickConnect();
              }}
              placeholder={isMobile ? "Search hosts…" : "Find a host or ssh user@hostname…"}
              className="transition-ui w-full rounded-xl border py-2.5 pl-10 pr-3.5 text-sm outline-none"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            />
          </div>

          <div className={`flex shrink-0 gap-2 ${isMobile ? "w-full" : ""}`}>
            {!isMobile && (
              <button
                type="button"
                onClick={onOpenLocalTerminal}
                className="hover-subtle transition-ui inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                title="Open a local terminal"
              >
                <SquareTerminal size={16} />
                Terminal
              </button>
            )}
            <button
              type="button"
              onClick={() => onAddServer()}
              className={`home-action-primary transition-ui inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ${
                isMobile ? "flex-1" : "shrink-0"
              }`}
            >
              <Plus size={16} />
              New host
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 px-0.5">
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {selectedIds.size} selected
              {filteredHosts.length > selectedIds.size && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="ml-2 underline-offset-2 hover:underline"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Select all {filteredHosts.length}
                </button>
              )}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={clearSelection}
                className="hover-subtle inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                <X size={13} />
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteHosts(selectedHosts);
                }}
                className="hover-subtle inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
                style={{ color: "var(--danger)" }}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : hosts.length === 0 && groups.length === 0 ? (
            <EmptyHostsState onAddServer={() => onAddServer()} />
          ) : grouped.length === 0 ? (
            <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No matches
            </p>
          ) : (
            grouped.map(({ group, hosts: sectionHosts }) => (
              <div key={group?.id ?? "ungrouped"}>
                <GroupSection
                  group={group ? groups.find((g) => g.id === group.id) ?? null : null}
                  hosts={sectionHosts}
                  connectingHostId={connectingHostId}
                  selectedHostIds={selectedIds}
                  onConnect={onConnect}
                  onEditHost={onEditHost}
                  onSelectToggle={toggleSelect}
                  onGroupContextMenu={(e, g) => openMenu(e, groupMenu(g))}
                  onHostContextMenu={(e, host) => openMenu(e, hostMenu(host))}
                  compact={isMobile}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
