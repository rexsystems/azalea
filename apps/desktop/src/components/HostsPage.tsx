import { useMemo, useState } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import {
  Folder,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  SquareTerminal,
  Tag,
  Trash2,
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

  const hostMenu = (host: Host) => [
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
                ? "Connect to servers, organize groups, and open shells"
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
                  onConnect={onConnect}
                  onEditHost={onEditHost}
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
