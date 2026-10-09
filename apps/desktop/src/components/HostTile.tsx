import type { Host, HostGroup } from "@azalea/shared";
import { Pencil, Server, Tick } from "./icons";
import { useHideHostAddresses } from "../hooks/useHideHostAddresses";
import { formatHostEndpoint } from "../lib/utils";
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
    <div
      className="group relative"
      data-host-tile
      onContextMenu={(e) => onContextMenu?.(e, host)}
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
        className={`hover-subtle transition-ui flex w-full items-center text-left disabled:opacity-50 ${
          compact
            ? "gap-3 rounded-xl border px-3.5 py-3.5"
            : "gap-4 rounded-2xl border px-4 py-4"
        }`}
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
        <HostOsIcon
          osId={host.os_id}
          seed={host.id || host.name}
          size={compact ? 42 : 52}
          rounded={compact ? 11 : 14}
        />
        <div className="min-w-0 flex-1">
          <div
            className={`truncate font-medium ${compact ? "text-sm" : "text-base"}`}
            style={{ color: "var(--text)" }}
          >
            {host.name}
          </div>
          <div className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
            {formatHostEndpoint(host.username, host.hostname, hideAddress)}
          </div>
        </div>
        {connecting && (
          <span className="text-xs" style={{ color: "var(--accent)" }}>
            ...
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
}: GroupSectionProps) {
  const title = group?.name ?? "Ungrouped";
  const selectionActive = Boolean(selectedHostIds && selectedHostIds.size > 0);

  return (
    <section className="mb-6">
      <button
        type="button"
        onContextMenu={(e) => onGroupContextMenu(e, group)}
        className="mb-2 flex items-center gap-2 px-1 py-0.5"
      >
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "var(--bg-card)",
            color: "var(--text-muted)",
          }}
        >
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
      ) : (
        <div
          className={
            compact
              ? "flex flex-col gap-2"
              : "grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3"
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
    <div className="flex flex-col items-center justify-center py-20">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
        style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
      >
        <Server size={24} />
      </div>
      <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
        No hosts yet
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Add a server with New Host.
      </p>
      <button
        onClick={onAddServer}
        className="transition-ui mt-4 rounded-lg px-4 py-2 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--accent)";
        }}
      >
        New Host
      </button>
    </div>
  );
}
