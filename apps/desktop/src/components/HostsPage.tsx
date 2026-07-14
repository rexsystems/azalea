import { useMemo } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import { ChevronRight, FolderPlus, Plus, Search, SquareTerminal } from "lucide-react";
import { groupHostsByGroup } from "../lib/utils";
import { EmptyHostsState, GroupSection } from "./HostTile";
import { useContextMenu } from "./ui/ContextMenu";

interface HostsPageProps {
  hosts: Host[];
  groups: HostGroup[];
  connectingHostId: string | null;
  onConnect: (host: Host) => void;
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
}

export function HostsPage({
  hosts,
  groups,
  connectingHostId,
  onConnect,
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
}: HostsPageProps) {
  const { openMenu, menuElement } = useContextMenu();

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

  const buildMoveItems = (host: Host) =>
    groups.map((g) => ({
      id: `move-${g.id}`,
      label: g.id === host.group_id ? `✓ ${g.name}` : g.name,
      disabled: g.id === host.group_id,
      onClick: () => onMoveHost(host.id, g.id),
    }));

  const hostMenu = (host: Host) => [
    {
      items: [
        { id: "connect", label: "Connect", onClick: () => onConnect(host) },
        { id: "edit", label: "Edit", onClick: () => onEditHost(host) },
      ],
    },
    ...(groups.length > 0
      ? [
          {
            items: [
              ...buildMoveItems(host),
              ...(host.group_id
                ? [{ id: "ungroup", label: "Remove from group", onClick: () => onMoveHost(host.id, null) }]
                : []),
            ],
          },
        ]
      : []),
    {
      items: [{ id: "delete", label: "Delete", danger: true, onClick: () => onDeleteHost(host) }],
    },
  ];

  const groupMenu = (group: HostGroup | null) => {
    if (!group) {
      return [{ items: [{ id: "add", label: "Add server", onClick: () => onAddServer(null) }] }];
    }
    return [
      {
        items: [
          { id: "add", label: "Add server", onClick: () => onAddServer(group.id) },
          { id: "rename", label: "Rename", onClick: () => onRenameGroup(group) },
        ],
      },
      {
        items: [{ id: "del", label: "Delete group", danger: true, onClick: () => onDeleteGroup(group) }],
      },
    ];
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("[data-host-tile]")) return;
        openMenu(e, [
          {
            items: [
              { id: "add-server", label: "New Host", onClick: () => onAddServer() },
              { id: "add-group", label: "New Group", onClick: onAddGroup },
            ],
          },
        ]);
      }}
    >
      {menuElement}

      {/* Toolbar — Termius-style */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <div className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
          <span>Personal</span>
          <ChevronRight size={14} />
          <span style={{ color: "var(--text)" }}>Hosts</span>
        </div>

        <div className="relative mx-4 min-w-0 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onQuickConnect();
            }}
            placeholder="Find a host or ssh user@hostname..."
            className="transition-ui w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none"
            style={{
              background: "var(--bg-input)",
              borderColor: "var(--border-subtle)",
              color: "var(--text)",
            }}
          />
        </div>

        <button
          onClick={onOpenLocalTerminal}
          className="hover-subtle transition-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          title="Open a local PowerShell terminal"
        >
          <SquareTerminal size={14} />
          Terminal
        </button>

        <button
          onClick={() => onAddServer()}
          className="transition-ui inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent)";
          }}
        >
          <Plus size={14} />
          New Host
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {hosts.length === 0 && groups.length === 0 ? (
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
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface GroupsPageProps {
  groups: HostGroup[];
  hosts: Host[];
  onAddGroup: () => void;
  onAddServer: (groupId: string) => void;
  onRenameGroup: (group: HostGroup) => void;
  onDeleteGroup: (group: HostGroup) => void;
}

export function GroupsPage({
  groups,
  hosts,
  onAddGroup,
  onAddServer,
  onRenameGroup,
  onDeleteGroup,
}: GroupsPageProps) {
  const { openMenu, menuElement } = useContextMenu();

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: "var(--bg-base)" }}>
      {menuElement}

      <div
        className="flex shrink-0 items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
      >
        <h2 className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Groups
        </h2>
        <button
          onClick={onAddGroup}
          className="transition-ui flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
          style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
        >
          <FolderPlus size={14} />
          New group
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {groups.length === 0 ? (
          <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No groups yet. Create one to organize your servers.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const count = hosts.filter((h) => h.group_id === group.id).length;
              return (
                <div
                  key={group.id}
                  className="transition-ui group relative rounded-xl border p-4"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-subtle)",
                  }}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      {
                        items: [
                          { id: "add", label: "Add server", onClick: () => onAddServer(group.id) },
                          { id: "rename", label: "Rename", onClick: () => onRenameGroup(group) },
                        ],
                      },
                      {
                        items: [
                          { id: "del", label: "Delete", danger: true, onClick: () => onDeleteGroup(group) },
                        ],
                      },
                    ])
                  }
                >
                  <div className="font-medium" style={{ color: "var(--text)" }}>
                    {group.name}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {count} server{count === 1 ? "" : "s"}
                  </div>
                  <button
                    onClick={() => onAddServer(group.id)}
                    className="transition-ui mt-3 text-xs font-medium"
                    style={{ color: "var(--accent)" }}
                  >
                    + Add server
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
