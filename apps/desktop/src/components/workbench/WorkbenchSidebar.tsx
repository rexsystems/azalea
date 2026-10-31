import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import { HostOsIcon } from "../HostOsIcon";
import type { NavPage } from "../AppShell";
import { useHideHostAddresses } from "../../hooks/useHideHostAddresses";
import { formatHostEndpoint } from "../../lib/utils";
import { describeSince, formatSince } from "../../lib/relativeTime";
import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";
import {
  WbChevronDown,
  WbChevronRight,
  WbClose,
  WbForward,
  WbGear,
  WbKey,
  WbPlus,
  WbSnippet,
  WbTerminal,
  type WbIcon,
} from "./wbIcons";

const SidebarCollapsedContext = createContext(false);

/** Whether the workbench sidebar is currently shown as an icon rail. */
export function useSidebarCollapsed(): boolean {
  return useContext(SidebarCollapsedContext);
}

export interface SidebarFootActions {
  activeForwards: number;
  forwardsOpen: boolean;
  snippetsOpen: boolean;
  onForwards: () => void;
  onSnippets: () => void;
}

interface WorkbenchSidebarProps {
  collapsed: boolean;
  /** Highlighted page, or null while a terminal is in front. */
  activePage: NavPage | null;
  onNavigate: (page: NavPage) => void;
  foot: SidebarFootActions;
  accountSlot: ReactNode;
  children?: ReactNode;
}

interface FootRow {
  id: string;
  label: string;
  icon: WbIcon;
  current: boolean;
  meta?: ReactNode;
  onClick: () => void;
}

export function WorkbenchSidebar({
  collapsed,
  activePage,
  onNavigate,
  foot,
  accountSlot,
  children,
}: WorkbenchSidebarProps) {
  const rows: FootRow[] = [
    {
      id: "keys",
      label: "Keychain",
      icon: WbKey,
      current: activePage === "keys",
      onClick: () => onNavigate("keys"),
    },
    {
      id: "forwards",
      label: "Port forwards",
      icon: WbForward,
      current: foot.forwardsOpen,
      meta: foot.activeForwards > 0 ? <span className="wb-mono">{foot.activeForwards} active</span> : null,
      onClick: foot.onForwards,
    },
    {
      id: "snippets",
      label: "Snippets",
      icon: WbSnippet,
      current: foot.snippetsOpen,
      onClick: foot.onSnippets,
    },
    {
      id: "settings",
      label: "Settings",
      icon: WbGear,
      current: activePage === "settings",
      meta: <kbd className="wb-kbd">Ctrl ,</kbd>,
      onClick: () => onNavigate("settings"),
    },
  ];

  return (
    <SidebarCollapsedContext.Provider value={collapsed}>
      <nav className="wb-side" data-collapsed={collapsed ? "true" : "false"} aria-label="Workspace">
        <div className="wb-side-scroll">{children}</div>
        <div className="wb-side-foot">
          <ul role="list" className="wb-list">
            {rows.map(({ id, label, icon: Icon, current, meta, onClick }) => (
              <li key={id}>
                <button
                  type="button"
                  className="wb-row"
                  aria-current={current ? (id === "keys" || id === "settings" ? "page" : "true") : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  onClick={onClick}
                >
                  <Icon />
                  <span className="wb-row-label">{label}</span>
                  {meta && <span className="wb-meta">{meta}</span>}
                </button>
              </li>
            ))}
          </ul>
          {!collapsed && <div className="wb-acct-wrap">{accountSlot}</div>}
        </div>
      </nav>
    </SidebarCollapsedContext.Provider>
  );
}

export interface SidebarSession {
  id: string;
  title: string;
  status: SessionStatus;
  isLocal: boolean;
}

interface SidebarSessionsProps {
  sessions: SidebarSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function SidebarSessions({
  sessions,
  activeSessionId,
  onSelect,
  onClose,
}: SidebarSessionsProps) {
  const collapsed = useSidebarCollapsed();

  return (
    <section className="wb-section" aria-labelledby="wb-sessions-heading">
      <div className="wb-sec">
        <h2 id="wb-sessions-heading">Sessions</h2>
        {sessions.length > 0 && !collapsed && (
          <span className="wb-sec-note">{sessions.length} open</span>
        )}
      </div>

      {sessions.length === 0 ? (
        !collapsed && <p className="wb-row wb-row-note">No open sessions</p>
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
                  {session.isLocal ? (
                    <WbTerminal />
                  ) : (
                    <span className={`wb-dot ${status.tone}`} aria-hidden />
                  )}
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
                    <WbClose />
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

const COLLAPSED_GROUPS_KEY = "azalea-collapsed-host-groups";

function readCollapsedGroups(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

interface SidebarHostsProps {
  hosts: Host[];
  groups: HostGroup[];
  loading: boolean;
  connectingHostId: string | null;
  /** Hosts with an open session; their rows skip the "last connected" hint. */
  openHostIds: ReadonlySet<string>;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onAdd: () => void;
  onManage: () => void;
}

export function SidebarHosts({
  hosts,
  groups,
  loading,
  connectingHostId,
  openHostIds,
  onConnect,
  onEdit,
  onAdd,
  onManage,
}: SidebarHostsProps) {
  const collapsed = useSidebarCollapsed();
  const hideAddress = useHideHostAddresses();
  const [closedGroups, setClosedGroups] = useState(readCollapsedGroups);

  const toggleGroup = useCallback((id: string) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // Collapsing still works for this window when storage is unavailable.
      }
      return next;
    });
  }, []);

  const sections = useMemo(() => {
    const result: { id: string; name: string; hosts: Host[] }[] = groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        hosts: hosts.filter((host) => host.group_id === group.id),
      }))
      .filter((section) => section.hosts.length > 0);
    const known = new Set(groups.map((group) => group.id));
    const ungrouped = hosts.filter((host) => !host.group_id || !known.has(host.group_id));
    if (ungrouped.length > 0) {
      result.push({ id: "ungrouped", name: "Ungrouped", hosts: ungrouped });
    }
    return result;
  }, [hosts, groups]);

  // The rail has no room for a host tree; sessions and the foot stay reachable.
  if (collapsed) return null;

  return (
    <section className="wb-section wb-section-hosts" aria-labelledby="wb-hosts-heading">
      <div className="wb-sec">
        <h2 id="wb-hosts-heading">
          <button
            type="button"
            className="wb-sec-link"
            onClick={onManage}
            title="Manage hosts and groups"
          >
            Hosts
          </button>
        </h2>
        <button type="button" onClick={onAdd} aria-label="Add host" title="Add host">
          <WbPlus />
        </button>
      </div>

      {loading && hosts.length === 0 ? (
        <p className="wb-row wb-row-note" role="status">
          Loading hosts…
        </p>
      ) : hosts.length === 0 ? (
        <p className="wb-side-empty">
          No hosts yet. Add one, or import the entries from your SSH config.
        </p>
      ) : (
        sections.map((section) => {
          const open = !closedGroups.has(section.id);
          const listId = `wb-group-${section.id}`;
          return (
            <div key={section.id} className="wb-group">
              <button
                type="button"
                className="wb-grp"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => toggleGroup(section.id)}
              >
                {open ? <WbChevronDown /> : <WbChevronRight />}
                <span className="wb-row-label">{section.name}</span>
                <span className="wb-grp-n" aria-label={`${section.hosts.length} hosts`}>
                  {section.hosts.length}
                </span>
              </button>
              {open && (
                <ul role="list" className="wb-list" id={listId}>
                  {section.hosts.map((host) => {
                    const connecting = connectingHostId === host.id;
                    const isOpen = openHostIds.has(host.id);
                    const since = host.last_connected_at
                      ? formatSince(host.last_connected_at)
                      : "never";
                    const endpoint = formatHostEndpoint(host.username, host.hostname, hideAddress);
                    return (
                      <li key={host.id} className="wb-list-item">
                        <button
                          type="button"
                          className="wb-row wb-row-host"
                          disabled={connecting}
                          aria-busy={connecting || undefined}
                          aria-label={`Connect to ${host.name}, ${endpoint}. ${describeSince(
                            host.last_connected_at,
                          )}`}
                          title={endpoint}
                          onClick={() => onConnect(host)}
                        >
                          <HostOsIcon
                            osId={host.os_id}
                            seed={host.id || host.name}
                            size={16}
                            rounded={4}
                            padding={2}
                          />
                          <span className="wb-row-label">{host.name}</span>
                          {connecting ? (
                            <span className="wb-meta">Connecting…</span>
                          ) : (
                            !isOpen && since && <span className="wb-meta">{since}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="wb-row-action"
                          onClick={() => onEdit(host)}
                          aria-label={`Edit ${host.name}`}
                          title="Edit host"
                        >
                          <WbGear />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
