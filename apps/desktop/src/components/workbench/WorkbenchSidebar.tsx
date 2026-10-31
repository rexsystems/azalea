import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import {
  Home,
  KeyRound,
  Pencil,
  Plus,
  Server,
  Settings,
  SidebarLeft,
  SquareTerminal,
  X,
  type AppIcon,
} from "../icons";
import { HostOsIcon } from "../HostOsIcon";
import type { NavPage } from "../AppShell";
import { useHideHostAddresses } from "../../hooks/useHideHostAddresses";
import { formatHostEndpoint } from "../../lib/utils";
import { formatSince } from "../../lib/relativeTime";
import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";

const SidebarCollapsedContext = createContext(false);

/** Whether the workbench sidebar is currently shown as an icon rail. */
export function useSidebarCollapsed(): boolean {
  return useContext(SidebarCollapsedContext);
}

const NAV: { id: NavPage; label: string; icon: AppIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "keys", label: "Keychain", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings },
];

interface WorkbenchSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Highlighted page, or null while a terminal is in front. */
  activePage: NavPage | null;
  onNavigate: (page: NavPage) => void;
  accountSlot: ReactNode;
  version: string;
  children?: ReactNode;
}

export function WorkbenchSidebar({
  collapsed,
  onToggleCollapsed,
  activePage,
  onNavigate,
  accountSlot,
  version,
  children,
}: WorkbenchSidebarProps) {
  return (
    <SidebarCollapsedContext.Provider value={collapsed}>
      <nav
        className="wb-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        aria-label="Workspace"
      >
        <div className="wb-sidebar-head">
          <button
            type="button"
            className="wb-icon-btn"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <SidebarLeft size={14} />
          </button>
        </div>

        <ul className="wb-nav" role="list">
          {NAV.map(({ id, label, icon: Icon }) => {
            const current = activePage === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="wb-row wb-nav-item"
                  aria-current={current ? "page" : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  onClick={() => onNavigate(id)}
                >
                  <Icon size={14} />
                  <span className="wb-row-label">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="wb-sidebar-scroll">{children}</div>

        {!collapsed && (
          <div className="wb-sidebar-foot">
            {accountSlot}
            <div className="wb-version">Azalea {version}</div>
          </div>
        )}
      </nav>
    </SidebarCollapsedContext.Provider>
  );
}

export interface SidebarSession {
  id: string;
  title: string;
  status: SessionStatus;
  osId: string | null | undefined;
  isLocal: boolean;
}

interface SidebarSessionsProps {
  sessions: SidebarSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onOpenLocalTerminal: () => void;
}

export function SidebarSessions({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  onOpenLocalTerminal,
}: SidebarSessionsProps) {
  const collapsed = useSidebarCollapsed();

  return (
    <section className="wb-section" aria-labelledby="wb-sessions-heading">
      <div className="wb-section-head">
        <h2 id="wb-sessions-heading" className="wb-section-title">
          Sessions
          {sessions.length > 0 && <span className="wb-count">{sessions.length}</span>}
        </h2>
        {!collapsed && (
          <button
            type="button"
            className="wb-icon-btn"
            onClick={onOpenLocalTerminal}
            aria-label="New local terminal"
            title="New local terminal"
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        !collapsed && (
          <p className="wb-empty">
            No open sessions. Connect to a host below or start a local terminal.
          </p>
        )
      ) : (
        <ul role="list" className="wb-list">
          {sessions.map((session) => {
            const status = sessionStatusInfo(session.status);
            const current = session.id === activeSessionId;
            return (
              <li key={session.id} className="wb-list-item">
                <button
                  type="button"
                  className="wb-row"
                  aria-current={current ? "true" : undefined}
                  aria-label={`${session.title}, ${status.label}`}
                  title={collapsed ? `${session.title} (${status.label})` : undefined}
                  onClick={() => onSelect(session.id)}
                >
                  <span className="wb-row-icon">
                    {session.isLocal ? (
                      <span className="wb-local-icon" aria-hidden>
                        <SquareTerminal size={12} />
                      </span>
                    ) : (
                      <HostOsIcon
                        osId={session.osId}
                        seed={session.id}
                        size={18}
                        rounded={4}
                        padding={2}
                      />
                    )}
                    <span className={`wb-dot wb-dot-${status.tone}`} aria-hidden />
                  </span>
                  <span className="wb-row-label">{session.title}</span>
                </button>
                {!collapsed && (
                  <button
                    type="button"
                    className="wb-row-action"
                    onClick={() => onClose(session.id)}
                    aria-label={`Close ${session.title}`}
                    title="Close session"
                  >
                    <X size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface SidebarHostsProps {
  hosts: Host[];
  groups: HostGroup[];
  loading: boolean;
  connectingHostId: string | null;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onAdd: () => void;
}

export function SidebarHosts({
  hosts,
  groups,
  loading,
  connectingHostId,
  onConnect,
  onEdit,
  onAdd,
}: SidebarHostsProps) {
  const collapsed = useSidebarCollapsed();
  const hideAddress = useHideHostAddresses();

  const sections = useMemo(() => {
    const byName = (a: Host, b: Host) => a.name.localeCompare(b.name);
    const result: { id: string; name: string; hosts: Host[] }[] = groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        hosts: hosts.filter((host) => host.group_id === group.id).sort(byName),
      }))
      .filter((section) => section.hosts.length > 0);
    const known = new Set(groups.map((group) => group.id));
    const ungrouped = hosts
      .filter((host) => !host.group_id || !known.has(host.group_id))
      .sort(byName);
    if (ungrouped.length > 0) {
      result.push({ id: "ungrouped", name: "Ungrouped", hosts: ungrouped });
    }
    return result;
  }, [hosts, groups]);

  // The rail has no room for a host tree; sessions and nav stay reachable.
  if (collapsed) return null;

  return (
    <section className="wb-section" aria-labelledby="wb-hosts-heading">
      <div className="wb-section-head">
        <h2 id="wb-hosts-heading" className="wb-section-title">
          Hosts
          {hosts.length > 0 && <span className="wb-count">{hosts.length}</span>}
        </h2>
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onAdd}
          aria-label="Add host"
          title="Add host"
        >
          <Plus size={13} />
        </button>
      </div>

      {loading && hosts.length === 0 ? (
        <p className="wb-empty" role="status">
          Loading hosts…
        </p>
      ) : hosts.length === 0 ? (
        <div className="wb-empty">
          <p>No hosts saved yet. Add one with its address and login to connect over SSH.</p>
          <button type="button" className="wb-link-btn" onClick={onAdd}>
            Add a host
          </button>
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.id} className="wb-group" role="group" aria-label={section.name}>
            <div className="wb-group-title" aria-hidden>
              {section.name}
            </div>
            <ul role="list" className="wb-list">
              {section.hosts.map((host) => {
                const connecting = connectingHostId === host.id;
                const since = formatSince(host.last_connected_at);
                const endpoint = formatHostEndpoint(host.username, host.hostname, hideAddress);
                return (
                  <li key={host.id} className="wb-list-item">
                    <button
                      type="button"
                      className="wb-row wb-row-host"
                      disabled={connecting}
                      aria-busy={connecting || undefined}
                      aria-label={`Connect to ${host.name}, ${endpoint}${
                        since ? `, last connected ${since}` : ""
                      }`}
                      onClick={() => onConnect(host)}
                    >
                      <span className="wb-row-icon">
                        <HostOsIcon
                          osId={host.os_id}
                          seed={host.id || host.name}
                          size={18}
                          rounded={4}
                          padding={2}
                        />
                      </span>
                      <span className="wb-row-text">
                        <span className="wb-row-label">{host.name}</span>
                        <span className="wb-row-meta">
                          {connecting ? "Connecting…" : endpoint}
                        </span>
                      </span>
                      {since && !connecting && <span className="wb-row-aside">{since}</span>}
                    </button>
                    <button
                      type="button"
                      className="wb-row-action"
                      onClick={() => onEdit(host)}
                      aria-label={`Edit ${host.name}`}
                      title="Edit host"
                    >
                      <Pencil size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
