import { useEffect, useMemo, useRef, useState } from "react";
import type { Host, SshKey } from "@azalea/shared";
import {
  Folder,
  Home,
  KeyRound,
  Plus,
  Search,
  Server,
  Settings,
  SquareTerminal,
  type AppIcon,
} from "./icons";

export type CommandPaletteActionId =
  | "nav-home"
  | "nav-hosts"
  | "nav-keys"
  | "nav-settings"
  | "action-new-host"
  | "action-new-group"
  | "action-local-terminal"
  | "action-sign-in"
  | `host:${string}`
  | `key:${string}`;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  hosts: Host[];
  keys: SshKey[];
  isMobile?: boolean;
  signedIn?: boolean;
  onAction: (id: CommandPaletteActionId) => void;
}

interface CommandItem {
  id: CommandPaletteActionId;
  label: string;
  description?: string;
  group: string;
  icon: AppIcon;
  keywords?: string;
}

function matches(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const hay = `${item.label} ${item.description ?? ""} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}

export function CommandPalette({
  open,
  onClose,
  hosts,
  keys,
  isMobile = false,
  signedIn = false,
  onAction,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<CommandItem[]>(() => {
    const nav: CommandItem[] = [
      {
        id: "nav-home",
        label: "Home",
        description: "Overview and quick actions",
        group: "Navigate",
        icon: Home,
        keywords: "dashboard start",
      },
      {
        id: "nav-hosts",
        label: "Hosts",
        description: "Browse and connect to servers",
        group: "Navigate",
        icon: Server,
        keywords: "servers ssh",
      },
      {
        id: "nav-keys",
        label: "Keychain",
        description: "SSH keys and identities",
        group: "Navigate",
        icon: KeyRound,
        keywords: "keys ssh identity",
      },
      {
        id: "nav-settings",
        label: "Settings",
        description: "Theme, terminal, sync, backup",
        group: "Navigate",
        icon: Settings,
        keywords: "preferences account",
      },
    ];

    const actions: CommandItem[] = [
      {
        id: "action-new-host",
        label: "New host",
        description: "Add an SSH server",
        group: "Actions",
        icon: Plus,
        keywords: "add create server",
      },
      {
        id: "action-new-group",
        label: "New group",
        description: "Organize hosts",
        group: "Actions",
        icon: Folder,
        keywords: "folder organize",
      },
      ...(!isMobile
        ? [
            {
              id: "action-local-terminal" as const,
              label: "Local terminal",
              description: "Open a shell on this machine",
              group: "Actions",
              icon: SquareTerminal,
              keywords: "shell pty local",
            },
          ]
        : []),
      ...(!signedIn
        ? [
            {
              id: "action-sign-in" as const,
              label: "Sign in",
              description: "Cloud sync account",
              group: "Actions",
              icon: Settings,
              keywords: "login sync account",
            },
          ]
        : []),
    ];

    const hostItems: CommandItem[] = hosts.map((host) => ({
      id: `host:${host.id}` as CommandPaletteActionId,
      label: host.name,
      description: `${host.username}@${host.hostname}${host.port !== 22 ? `:${host.port}` : ""}`,
      group: "Hosts",
      icon: Server,
      keywords: `${host.hostname} ${host.username} ${host.os_id ?? ""}`,
    }));

    const keyItems: CommandItem[] = keys.map((key) => ({
      id: `key:${key.id}` as CommandPaletteActionId,
      label: key.name,
      description: key.key_type,
      group: "Keys",
      icon: KeyRound,
      keywords: `${key.fingerprint} ${key.key_type}`,
    }));

    return [...nav, ...actions, ...hostItems, ...keyItems];
  }, [hosts, keys, isMobile, signedIn]);

  const filtered = useMemo(
    () => items.filter((item) => matches(item, query.trim())),
    [items, query],
  );

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) {
        map.set(item.group, []);
        order.push(item.group);
      }
      map.get(item.group)!.push(item);
    }
    return order.map((name) => ({ name, items: map.get(name)! }));
  }, [filtered]);

  const flat = filtered;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[activeIndex];
        if (item) {
          onAction(item.id);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, activeIndex, onAction, onClose]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  if (!open) return null;

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-panel)",
          maxHeight: "min(32rem, 70vh)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
      >
        <div
          className="flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Search size={18} style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hosts, keys, actions…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
          />
          <kbd
            className="hidden rounded-md border px-1.5 py-0.5 text-[10px] font-medium sm:inline"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
          >
            Esc
          </kbd>
        </div>

        <div
          id="command-palette-list"
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto p-2"
          role="listbox"
        >
          {flat.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No results for “{query.trim()}”
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-2">
                <div
                  className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  {group.name}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    const active = index === activeIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-cmd-index={index}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-ui"
                        style={{
                          background: active ? "var(--nav-active)" : "transparent",
                          color: "var(--text)",
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          onAction(item.id);
                          onClose();
                        }}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: active ? "var(--accent-muted)" : "var(--bg-card)",
                            color: active ? "var(--accent)" : "var(--text-muted)",
                          }}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.label}</span>
                          {item.description && (
                            <span
                              className="block truncate text-[11px]"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {item.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div
          className="flex items-center justify-between border-t px-4 py-2 text-[10px]"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <span>↑↓ navigate · Enter open</span>
          <span>Ctrl+/</span>
        </div>
      </div>
    </div>
  );
}
