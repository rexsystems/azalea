import type { Host, HostGroup } from "@azalea/shared";
import { Pencil, Tick } from "./icons";
import { useHideHostAddresses } from "../hooks/useHideHostAddresses";
import { formatHostEndpoint, formatRelativeTime } from "../lib/utils";
import { HostOsIcon } from "./HostOsIcon";

interface HostTileProps {
  host: Host;
  connecting?: boolean;
  selected?: boolean;
  /** Show select checkboxes on all tiles while a multi-select session is active. */
  selectionActive?: boolean;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onSelectToggle?: (host: Host) => void;
  onContextMenu?: (e: React.MouseEvent, host: Host) => void;
  compact?: boolean;
}

export function HostTile({
  host,
  connecting,
  selected = false,
  selectionActive = false,
  onConnect,
  onEdit,
  onSelectToggle,
  onContextMenu,
  compact = false,
}: HostTileProps) {
  const hideAddress = useHideHostAddresses();
  const showCheckbox = selected || selectionActive;

  return (
    <div className="group relative" data-host-tile onContextMenu={(e) => onContextMenu?.(e, host)}>
      <button
        type="button"
        disabled={connecting}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || selectionActive) {
            e.preventDefault();
            onSelectToggle?.(host);
            return;
          }
          onConnect(host);
        }}
        className="hover-subtle transition-ui flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left disabled:opacity-50"
        style={{
          background: "var(--bg-card)",
          borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
          boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : undefined,
        }}
      >
        {showCheckbox && (
          <span
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? "Deselect host" : "Select host"}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectToggle?.(host);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-ui"
            style={{
              background: selected ? "var(--accent)" : "var(--bg-input)",
              borderColor: selected ? "var(--accent)" : "var(--border)",
              color: "var(--accent-fg, #fff)",
            }}
          >
            {selected ? <Tick size={12} strokeWidth={2.5} /> : null}
          </span>
        )}
        <HostOsIcon osId={host.os_id} seed={host.id || host.name} size={40} rounded={10} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
            {host.name}
          </div>
          <div className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {formatHostEndpoint(host.username, host.hostname, hideAddress)}
            {host.last_connected_at ? ` · ${formatRelativeTime(host.last_connected_at)}` : ""}
          </div>
        </div>
        {connecting && (
          <span className="text-xs" style={{ color: "var(--accent)" }}>
            Connecting…
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(host);
        }}
        className={`transition-ui absolute right-2.5 top-2.5 rounded-md p-1.5 ${
          compact || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        style={{
          background: "var(--bg-panel)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border-subtle)",
        }}
        aria-label="Edit server"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

interface GroupSectionProps {
  group: HostGroup | null;
  hosts: Host[];
  connectingHostId: string | null;
  selectedHostIds?: Set<string>;
  onConnect: (host: Host) => void;
  onEditHost: (host: Host) => void;
  onSelectToggle?: (host: Host) => void;
  onGroupContextMenu: (e: React.MouseEvent, group: HostGroup | null) => void;
  onHostContextMenu: (e: React.MouseEvent, host: Host) => void;
  compact?: boolean;
  /** One hairline-separated list instead of a grid of cards. */
  list?: boolean;
}

export function GroupSection({
  group,
  hosts,
  connectingHostId,
  selectedHostIds,
  onConnect,
  onEditHost,
  onSelectToggle,
  onGroupContextMenu,
  onHostContextMenu,
  compact = false,
  list = false,
}: GroupSectionProps) {
  const title = group?.name ?? "Ungrouped";
  const selectionActive = Boolean(selectedHostIds && selectedHostIds.size > 0);

  return (
    <section className="mb-7">
      <button
        type="button"
        onContextMenu={(e) => onGroupContextMenu(e, group)}
        className="mb-2 flex items-baseline gap-2 px-1 py-0.5"
      >
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {title}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
          {hosts.length}
        </span>
      </button>

      {hosts.length === 0 ? (
        <div
          className="rounded-xl border border-dashed py-6 text-center text-xs"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--text-muted)",
          }}
        >
          Empty group. Add a server.
        </div>
      ) : list ? (
        <ul
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          {hosts.map((host, index) => (
            <li
              key={host.id}
              style={index > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined}
            >
              <HostListRow
                host={host}
                connecting={connectingHostId === host.id}
                selected={selectedHostIds?.has(host.id)}
                selectionActive={selectionActive}
                onConnect={onConnect}
                onEdit={onEditHost}
                onSelectToggle={onSelectToggle}
                onContextMenu={onHostContextMenu}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div
          className={
            compact
              ? "flex flex-col gap-2"
              : "grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-2.5"
          }
        >
          {hosts.map((host) => (
            <HostTile
              key={host.id}
              host={host}
              connecting={connectingHostId === host.id}
              selected={selectedHostIds?.has(host.id)}
              selectionActive={selectionActive}
              onConnect={onConnect}
              onEdit={onEditHost}
              onSelectToggle={onSelectToggle}
              onContextMenu={onHostContextMenu}
              compact={compact}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function EmptyHostsState({ onAddServer }: { onAddServer: () => void }) {
  return (
    <div className="flex flex-col items-start gap-1 py-12">
      <p className="text-base font-medium" style={{ color: "var(--text)" }}>
        No hosts yet
      </p>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Add an SSH host to connect, or type ssh user@hostname in the search box.
      </p>
      <button
        type="button"
        onClick={onAddServer}
        className="home-action-primary transition-ui mt-3 rounded-xl px-4 py-2 text-sm font-medium"
      >
        New host
      </button>
    </div>
  );
}

interface HostRowProps {
  host: Host;
  /** The row whose details are open on the right. */
  focused: boolean;
  /** Part of a multi-selection. */
  selected: boolean;
  selectionActive: boolean;
  connecting: boolean;
  onFocus: (host: Host) => void;
  onConnect: (host: Host) => void;
  onSelectToggle: (host: Host) => void;
  onContextMenu: (e: React.MouseEvent, host: Host) => void;
}

export function HostRow({
  host,
  focused,
  selected,
  selectionActive,
  connecting,
  onFocus,
  onConnect,
  onSelectToggle,
  onContextMenu,
}: HostRowProps) {
  const hideAddress = useHideHostAddresses();
  return (
    <button
      type="button"
      data-host-row={host.id}
      data-host-tile
      aria-current={focused ? "true" : undefined}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || selectionActive) {
          onSelectToggle(host);
          return;
        }
        onFocus(host);
      }}
      onDoubleClick={() => onConnect(host)}
      onContextMenu={(e) => onContextMenu(e, host)}
      className={`transition-ui flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${
        focused ? "" : "hover-subtle"
      }`}
      style={{
        background: focused ? "var(--nav-active)" : "transparent",
        boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : undefined,
      }}
    >
      <HostOsIcon osId={host.os_id} seed={host.id || host.name} size={32} rounded={8} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" style={{ color: "var(--text)" }}>
          {host.name}
        </span>
        <span className="block truncate font-mono text-xs" style={{ color: "var(--text-muted)" }}>
          {formatHostEndpoint(host.username, host.hostname, hideAddress)}
        </span>
      </span>
      {connecting && (
        <span className="shrink-0 text-xs" style={{ color: "var(--accent)" }}>
          Connecting…
        </span>
      )}
    </button>
  );
}

interface HostListRowProps {
  host: Host;
  connecting?: boolean;
  selected?: boolean;
  selectionActive?: boolean;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onSelectToggle?: (host: Host) => void;
  onContextMenu?: (e: React.MouseEvent, host: Host) => void;
}

function HostListRow({
  host,
  connecting,
  selected = false,
  selectionActive = false,
  onConnect,
  onEdit,
  onSelectToggle,
  onContextMenu,
}: HostListRowProps) {
  const hideAddress = useHideHostAddresses();
  return (
    <div
      className="group relative flex items-center"
      data-host-tile
      onContextMenu={(e) => onContextMenu?.(e, host)}
      style={{ boxShadow: selected ? "inset 0 0 0 1px var(--accent)" : undefined }}
    >
      <button
        type="button"
        disabled={connecting}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || selectionActive) {
            e.preventDefault();
            onSelectToggle?.(host);
            return;
          }
          onConnect(host);
        }}
        className="hover-subtle transition-ui flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left disabled:opacity-50"
      >
        <HostOsIcon osId={host.os_id} seed={host.id || host.name} size={32} rounded={8} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" style={{ color: "var(--text)" }}>
            {host.name}
          </span>
          <span className="block truncate font-mono text-xs" style={{ color: "var(--text-muted)" }}>
            {formatHostEndpoint(host.username, host.hostname, hideAddress)}
          </span>
        </span>
        <span
          className="shrink-0 pr-8 text-xs tabular-nums"
          style={{ color: connecting ? "var(--accent)" : "var(--text-muted)" }}
        >
          {connecting
            ? "Connecting…"
            : host.last_connected_at
              ? formatRelativeTime(host.last_connected_at)
              : "Never connected"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEdit(host)}
        className="transition-ui absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        style={{ color: "var(--text-secondary)" }}
        aria-label={`Edit ${host.name}`}
      >
        <Pencil size={14} />
      </button>
    </div>
  );
}
