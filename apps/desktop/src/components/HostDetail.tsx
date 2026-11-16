import type { ReactNode } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import { useHideHostAddresses } from "../hooks/useHideHostAddresses";
import { formatRelativeTime } from "../lib/utils";
import { HostOsIcon } from "./HostOsIcon";
import { Pencil, Play, SquareTerminal, Zap } from "./icons";

interface HostDetailProps {
  host: Host;
  group: HostGroup | null;
  connecting: boolean;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onRunCommand: (hosts: Host[]) => void;
  onWake: (host: Host) => void;
  /** Extra actions (Delete, Move to group) opened from the context menu. */
  onMore: (e: React.MouseEvent, host: Host) => void;
}

const authLabel: Record<Host["auth_type"], string> = {
  password: "Password",
  key: "SSH key",
  none: "None",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="grid grid-cols-[8rem_1fr] gap-4 border-b py-2.5 text-sm"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="min-w-0 break-words" style={{ color: "var(--text)" }}>
        {children}
      </dd>
    </div>
  );
}

export function HostDetail({
  host,
  group,
  connecting,
  onConnect,
  onEdit,
  onRunCommand,
  onWake,
  onMore,
}: HostDetailProps) {
  const hideAddress = useHideHostAddresses();
  const lastConnected = host.last_connected_at
    ? `${formatRelativeTime(host.last_connected_at)} · ${new Date(
        host.last_connected_at * 1000,
      ).toLocaleString()}`
    : "Never connected";

  return (
    <article aria-label={`Details for ${host.name}`}>
      <header className="flex items-center gap-4">
        <HostOsIcon osId={host.os_id} seed={host.id || host.name} size={56} rounded={14} />
        <div className="min-w-0">
          <h2
            className="truncate text-2xl font-semibold tracking-tight"
            style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
          >
            {host.name}
          </h2>
          <p className="truncate font-mono text-sm" style={{ color: "var(--text-muted)" }}>
            {hideAddress ? host.username : `${host.username}@${host.hostname}`}
          </p>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={connecting}
          onClick={() => onConnect(host)}
          className="home-action-primary transition-ui inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          <Play size={15} />
          {connecting ? "Connecting…" : "Connect"}
        </button>
        <button
          type="button"
          onClick={() => onRunCommand([host])}
          className="hover-subtle transition-ui inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <SquareTerminal size={15} />
          Run command
        </button>
        <button
          type="button"
          onClick={() => onEdit(host)}
          className="hover-subtle transition-ui inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <Pencil size={15} />
          Edit
        </button>
        {host.mac_address && (
          <button
            type="button"
            onClick={() => onWake(host)}
            className="hover-subtle transition-ui inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            <Zap size={15} />
            Wake up
          </button>
        )}
        <button
          type="button"
          onClick={(e) => onMore(e, host)}
          className="hover-subtle transition-ui rounded-xl px-3 py-2.5 text-sm font-medium"
          style={{ color: "var(--text-muted)" }}
          aria-haspopup="menu"
        >
          More
        </button>
      </div>

      <dl className="mt-6 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <Fact label="Address">
          <span className="font-mono">{hideAddress ? "Hidden" : host.hostname}</span>
        </Fact>
        <Fact label="Port">
          <span className="font-mono tabular-nums">{host.port}</span>
        </Fact>
        <Fact label="User">
          <span className="font-mono">{host.username}</span>
        </Fact>
        <Fact label="Authentication">{authLabel[host.auth_type]}</Fact>
        <Fact label="Group">{group?.name ?? "None"}</Fact>
        <Fact label="Last connected">{lastConnected}</Fact>
        {host.mac_address && (
          <Fact label="Wake-on-LAN">
            <span className="font-mono">{host.mac_address}</span>
          </Fact>
        )}
      </dl>
    </article>
  );
}
