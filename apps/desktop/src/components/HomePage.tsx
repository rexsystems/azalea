import { useMemo } from "react";
import type { Host, SshKey } from "@azalea/shared";
import { formatHostEndpoint } from "../lib/utils";
import { HostOsIcon } from "./HostOsIcon";
import { KeyRound, Plus, Server, Settings, SquareTerminal } from "./icons";

interface HomePageProps {
  hosts: Host[];
  keys: SshKey[];
  openSessions: number;
  connectingHostId: string | null;
  onConnect: (host: Host) => void;
  onAddServer: () => void;
  onOpenLocalTerminal: () => void;
  onOpenHosts: () => void;
  onOpenKeys: () => void;
  onOpenSettings: () => void;
  isMobile?: boolean;
}

export function HomePage({
  hosts,
  keys,
  openSessions,
  connectingHostId,
  onConnect,
  onAddServer,
  onOpenLocalTerminal,
  onOpenHosts,
  onOpenKeys,
  onOpenSettings,
  isMobile = false,
}: HomePageProps) {
  const recent = useMemo(
    () => [...hosts].sort((a, b) => b.updated_at - a.updated_at).slice(0, 6),
    [hosts],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    const messages =
      h >= 5 && h < 12
        ? [
            "Good morning",
            "Morning",
            "Rise and shine",
            "Fresh start",
            "Coffee first?",
          ]
        : h >= 12 && h < 18
          ? [
              "Good afternoon",
              "Hey there",
              "Keep going",
              "Afternoon focus",
              "Back at it",
            ]
          : h >= 18 && h < 22
            ? [
                "Good evening",
                "Evening, captain",
                "Wrapping up?",
                "Nice and calm",
                "Still shipping?",
              ]
            : [
                "Good night",
                "Late session",
                "Burning the midnight oil",
                "Quiet hours",
                "Night owl mode",
              ];

    const day = new Date().toDateString();
    const bucket = h >= 5 && h < 12 ? "am" : h >= 12 && h < 18 ? "pm" : h >= 18 && h < 22 ? "eve" : "night";
    let hash = 0;
    const seed = `${day}:${bucket}`;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return messages[hash % messages.length];
  }, []);

  const stats = [
    { label: "Hosts", value: hosts.length, onClick: onOpenHosts },
    { label: "Keys", value: keys.length, onClick: onOpenKeys },
    { label: "Sessions", value: openSessions, onClick: undefined },
  ];

  const actions = [
    {
      label: "New host",
      description: "Add an SSH server",
      icon: Plus,
      onClick: onAddServer,
      primary: true,
    },
    ...(!isMobile
      ? [
          {
            label: "Local terminal",
            description: "Open a shell here",
            icon: SquareTerminal,
            onClick: onOpenLocalTerminal,
            primary: false,
          },
        ]
      : []),
    {
      label: "Keychain",
      description: "Manage identities",
      icon: KeyRound,
      onClick: onOpenKeys,
      primary: false,
    },
    {
      label: "Settings",
      description: "Theme, sync, backup",
      icon: Settings,
      onClick: onOpenSettings,
      primary: false,
    },
  ];

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell flex min-h-0 flex-1 flex-col overflow-y-auto !pb-6">
        <div className="mb-6 shrink-0">
          <div className="min-w-0">
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
            >
              {greeting}
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
              {hosts.length === 0
                ? "Add your first host to get started."
                : "Pick up where you left off, or jump in with a quick action."}
            </p>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <button
              key={stat.label}
              type="button"
              disabled={!stat.onClick}
              onClick={stat.onClick}
              className="rounded-2xl border px-4 py-3.5 text-left transition-ui disabled:cursor-default"
              style={{
                borderColor: "var(--border-subtle)",
                background: "var(--bg-panel)",
                color: "var(--text)",
              }}
            >
              <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {stat.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {stat.value}
              </div>
            </button>
          ))}
        </div>

        <div
          className="mb-5 rounded-2xl border p-5 sm:p-6"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <div className="mb-4">
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              Quick actions
            </h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Common stuff, one click away.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {actions.map(({ label, description, icon: Icon, onClick, primary }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className={`home-action flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-ui ${
                  primary ? "home-action-primary" : "hover-subtle"
                }`}
                style={{
                  borderColor: primary ? "transparent" : "var(--border-subtle)",
                  color: primary ? "var(--accent-fg, #fff)" : "var(--text)",
                }}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    primary ? "home-action-primary-icon" : ""
                  }`}
                  style={{
                    background: primary ? undefined : "var(--accent-muted)",
                    color: primary ? "inherit" : "var(--accent)",
                  }}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{label}</span>
                  <span
                    className={`block truncate text-[11px] ${primary ? "home-action-primary-desc" : ""}`}
                    style={{ color: primary ? undefined : "var(--text-muted)" }}
                  >
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          className="rounded-2xl border p-5 sm:p-6"
          style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                Recent hosts
              </h3>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                Last updated on this device.
              </p>
            </div>
            {hosts.length > 0 && (
              <button
                type="button"
                onClick={onOpenHosts}
                className="shrink-0 text-sm font-medium"
                style={{ color: "var(--accent)" }}
              >
                View all
              </button>
            )}
          </div>

          {recent.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <Server size={22} style={{ color: "var(--text-muted)" }} />
              <p className="mt-3 text-sm font-medium" style={{ color: "var(--text)" }}>
                No hosts yet
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                Create one and it will show up here.
              </p>
              <button
                type="button"
                onClick={onAddServer}
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium"
                style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
              >
                <Plus size={15} />
                New host
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {recent.map((host) => {
                const connecting = connectingHostId === host.id;
                return (
                  <button
                    key={host.id}
                    type="button"
                    disabled={connecting}
                    onClick={() => onConnect(host)}
                    className="flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-ui hover-subtle disabled:opacity-50"
                    style={{
                      borderColor: "var(--border-subtle)",
                      background: "var(--bg-card)",
                    }}
                  >
                    <HostOsIcon osId={host.os_id} seed={host.id || host.name} size={40} rounded={11} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                        {host.name}
                      </span>
                      <span className="block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {formatHostEndpoint(host.username, host.hostname)}
                      </span>
                    </span>
                    {connecting && (
                      <span className="text-xs" style={{ color: "var(--accent)" }}>
                        ...
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
