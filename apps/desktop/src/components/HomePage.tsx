import { useMemo, useState, type ReactNode } from "react";
import type { Host } from "@azalea/shared";
import { useHideHostAddresses } from "../hooks/useHideHostAddresses";
import { formatHostEndpoint, formatRelativeTime } from "../lib/utils";
import { HostOsIcon } from "./HostOsIcon";
import { Plus, Search, SquareTerminal } from "./icons";

interface HomePageProps {
  hosts: Host[];
  openSessions: number;
  connectingHostId: string | null;
  onConnect: (host: Host) => void;
  onAddServer: () => void;
  /** Called with the typed text when it matches no saved host. */
  onQuickConnect: (query: string) => void;
  onOpenLocalTerminal: () => void;
  onOpenHosts: () => void;
  isMobile?: boolean;
  workspacesSection?: ReactNode;
}

const RECENT_LIMIT = 6;

function matchesQuery(host: Host, q: string): boolean {
  return (
    host.name.toLowerCase().includes(q) ||
    host.hostname.toLowerCase().includes(q) ||
    host.username.toLowerCase().includes(q)
  );
}

export function HomePage({
  hosts,
  openSessions,
  connectingHostId,
  onConnect,
  onAddServer,
  onQuickConnect,
  onOpenLocalTerminal,
  onOpenHosts,
  isMobile = false,
  workspacesSection,
}: HomePageProps) {
  const hideAddress = useHideHostAddresses();
  const [query, setQuery] = useState("");

  const byRecency = useMemo(
    () =>
      [...hosts].sort((a, b) => {
        const ac = a.last_connected_at ?? 0;
        const bc = b.last_connected_at ?? 0;
        if (bc !== ac) return bc - ac;
        return b.updated_at - a.updated_at;
      }),
    [hosts],
  );

  const trimmed = query.trim().toLowerCase();
  const searching = trimmed.length > 0;
  const shown = searching
    ? byRecency.filter((host) => matchesQuery(host, trimmed))
    : byRecency.slice(0, RECENT_LIMIT);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning";
    if (h >= 12 && h < 18) return "Good afternoon";
    if (h >= 18 && h < 22) return "Good evening";
    return "Good night";
  }, []);

  const submit = () => {
    if (!searching) return;
    if (shown.length === 1) {
      onConnect(shown[0]);
      return;
    }
    if (shown.length === 0) onQuickConnect(query);
  };

  const subtitle =
    hosts.length === 0
      ? "Add an SSH host to get started."
      : openSessions > 0
        ? `${openSessions} open ${openSessions === 1 ? "session" : "sessions"}`
        : `${hosts.length} saved ${hosts.length === 1 ? "host" : "hosts"}`;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="settings-shell flex min-h-0 flex-1 flex-col overflow-y-auto !pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-6 flex shrink-0 flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
                style={{ color: "var(--text)", fontFamily: "var(--font-display, inherit)" }}
              >
                {greeting}
              </h2>
              <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
                {subtitle}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {!isMobile && (
                <button
                  type="button"
                  onClick={onOpenLocalTerminal}
                  className="hover-subtle transition-ui inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
                  style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
                >
                  <SquareTerminal size={16} />
                  Local terminal
                </button>
              )}
              <button
                type="button"
                onClick={onAddServer}
                className="home-action-primary transition-ui inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium"
              >
                <Plus size={16} />
                New host
              </button>
            </div>
          </div>

          <div className="relative mb-6 shrink-0">
            <Search
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setQuery("");
              }}
              placeholder={isMobile ? "Search hosts…" : "Find a host or type ssh user@hostname…"}
              aria-label="Find a host or connect to a new one"
              className="transition-ui w-full rounded-xl border py-3 pl-10 pr-3.5 text-sm outline-none focus:border-[var(--accent)]"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--border-subtle)",
                color: "var(--text)",
              }}
            />
          </div>

          {workspacesSection}

          <section aria-label={searching ? "Search results" : "Recent hosts"}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                {searching ? "Matching hosts" : "Recent"}
              </h3>
              {!searching && hosts.length > RECENT_LIMIT && (
                <button
                  type="button"
                  onClick={onOpenHosts}
                  className="text-sm font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  All {hosts.length} hosts
                </button>
              )}
            </div>

            {shown.length === 0 ? (
              <p
                className="rounded-xl border border-dashed px-4 py-8 text-center text-sm"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                {searching
                  ? "No saved host matches. Press Enter to add it as a new host."
                  : "No hosts yet. Use New host to add your first one."}
              </p>
            ) : (
              <ul
                className="overflow-hidden rounded-xl border"
                style={{ borderColor: "var(--border-subtle)", background: "var(--bg-panel)" }}
              >
                {shown.map((host, index) => {
                  const connecting = connectingHostId === host.id;
                  return (
                    <li
                      key={host.id}
                      style={
                        index > 0 ? { borderTop: "1px solid var(--border-subtle)" } : undefined
                      }
                    >
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => onConnect(host)}
                        className="hover-subtle transition-ui flex w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left disabled:opacity-50"
                      >
                        <HostOsIcon
                          osId={host.os_id}
                          seed={host.id || host.name}
                          size={36}
                          rounded={9}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-sm font-medium"
                            style={{ color: "var(--text)" }}
                          >
                            {host.name}
                          </span>
                          <span
                            className="block truncate text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {formatHostEndpoint(host.username, host.hostname, hideAddress)}
                          </span>
                        </span>
                        <span
                          className="shrink-0 text-xs tabular-nums"
                          style={{ color: connecting ? "var(--accent)" : "var(--text-muted)" }}
                        >
                          {connecting
                            ? "Connecting…"
                            : host.last_connected_at
                              ? formatRelativeTime(host.last_connected_at)
                              : "Never connected"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
