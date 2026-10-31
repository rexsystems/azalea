import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Home, KeyRound, Server, Settings, type AppIcon } from "./icons";
import { getVersion } from "@tauri-apps/api/app";
import type { AccountKind, AccountRecord, SyncStatus } from "../lib/api";
import { TitleBar } from "./TitleBar";
import { Logo } from "./Logo";
import { AccountSwitcher } from "./AccountSwitcher";
import { WorkbenchTitleBar, type TitleBarWorkspaces } from "./workbench/WorkbenchTitleBar";
import { WorkbenchSidebar, type SidebarFootActions } from "./workbench/WorkbenchSidebar";
import type { UiMode } from "../lib/appearance";

const SIDEBAR_COLLAPSED_KEY = "azalea-sidebar-collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export type NavPage = "home" | "hosts" | "keys" | "settings";

interface AppShellProps {
  children: ReactNode;
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  accounts: AccountRecord[];
  activeAccount: AccountRecord | null;
  onSwitchAccount: (id: string) => void | Promise<void>;
  onAddAccount: (input: {
    kind: AccountKind;
    label: string;
    base_url?: string | null;
    web_url?: string | null;
  }) => void | Promise<void>;
  onConnectSelfhost: (input: {
    label: string;
    base_url: string;
    web_url?: string | null;
    email: string;
    password: string;
  }) => void | Promise<void>;
  onConnectSelfhostBrowser: (input: {
    label: string;
    base_url: string;
    web_url: string;
  }) => void | Promise<void>;
  onConnectPersonalCloud?: (
    provider: "gdrive" | "onedrive" | "dropbox",
  ) => void | Promise<void>;
  onRemoveAccount: (id: string) => void | Promise<void>;
  onCopyAccountData?: (fromId: string) => void | Promise<void>;
  onOpenAccount?: () => void;
  onSignInForSync?: () => void;
  onPasswordLogin?: (email: string, password: string) => void | Promise<void>;
  statusMessage?: string;
  syncStatus?: SyncStatus | null;
  showTabs?: boolean;
  tabBar?: ReactNode;
  sidePanel?: ReactNode;
  isMobile?: boolean;
  /** When true on mobile, hide bottom nav for a full-bleed terminal. */
  immersive?: boolean;
  /** Interface mode. New and Minimal use the workbench layout on desktop. */
  uiMode?: UiMode;
  /** Workbench only: sessions and hosts lists rendered in the sidebar. */
  sidebarContent?: ReactNode;
  /** Workbench only: status line rendered under the work area. */
  footer?: ReactNode;
  /** Workbench only: opens the command palette from the title bar. */
  onOpenPalette?: () => void;
  /** Workbench only: a terminal is in front, so no nav page is current. */
  viewingTerminal?: boolean;
  /** Workbench only: saved workspaces for the title bar switcher. */
  workspaces?: TitleBarWorkspaces;
  /** Workbench only: forwards and snippets entries in the sidebar foot. */
  sidebarFoot?: SidebarFootActions;
  /** Workbench only: right-hand panel, laid out as its own column. */
  inspector?: ReactNode;
}

const NO_WORKSPACES: TitleBarWorkspaces = {
  items: [],
  activeId: null,
  canSave: false,
  onOpen: () => undefined,
  onSave: () => undefined,
  onManage: () => undefined,
};

const NO_FOOT: SidebarFootActions = {
  activeForwards: 0,
  forwardsOpen: false,
  snippetsOpen: false,
  onForwards: () => undefined,
  onSnippets: () => undefined,
};

const primaryNav: { id: NavPage; label: string; icon: AppIcon }[] = [
  { id: "home", label: "Home", icon: Home },
];

const secondaryNav: { id: NavPage; label: string; icon: AppIcon }[] = [
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "keys", label: "Keychain", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings },
];

const allNav = [...primaryNav, ...secondaryNav];

function NavButton({
  id,
  label,
  icon: Icon,
  active,
  onNavigate,
  compact = false,
}: {
  id: NavPage;
  label: string;
  icon: AppIcon;
  active: boolean;
  onNavigate: (page: NavPage) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(id)}
        className="transition-ui flex flex-col items-center gap-1 rounded-xl px-2 py-2"
        style={{
          background: active ? "var(--nav-active)" : "transparent",
          color: active ? "var(--text)" : "var(--text-muted)",
        }}
      >
        <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
        <span className="text-[10px] font-medium">{label === "Keychain" ? "Keys" : label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(id)}
      className={`transition-ui flex w-full items-center gap-3 rounded-lg px-3.5 py-[0.65rem] text-sm ${
        active ? "" : "hover-subtle"
      }`}
      style={{
        background: active ? "var(--nav-active)" : "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
      }}
    >
      <Icon size={18} strokeWidth={active ? 2 : 1.5} />
      {label}
    </button>
  );
}

export function AppShell({
  children,
  activePage,
  onNavigate,
  accounts,
  activeAccount,
  onSwitchAccount,
  onAddAccount,
  onConnectSelfhost,
  onConnectSelfhostBrowser,
  onConnectPersonalCloud,
  onRemoveAccount,
  onCopyAccountData,
  onOpenAccount,
  onSignInForSync,
  onPasswordLogin,
  statusMessage,
  syncStatus,
  showTabs,
  tabBar,
  sidePanel,
  isMobile = false,
  immersive = false,
  uiMode = "legacy",
  sidebarContent,
  footer,
  onOpenPalette,
  viewingTerminal = false,
  workspaces = NO_WORKSPACES,
  sidebarFoot = NO_FOOT,
  inspector,
}: AppShellProps) {
  const [appVersion, setAppVersion] = useState("…");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  // Minimal UI folds the sidebar while a terminal is in front. Expanding it
  // there lasts until the user leaves or re-enters the terminal.
  const [terminalPeek, setTerminalPeek] = useState(false);
  const [peekTerminalState, setPeekTerminalState] = useState(viewingTerminal);
  if (peekTerminalState !== viewingTerminal) {
    setPeekTerminalState(viewingTerminal);
    setTerminalPeek(false);
  }

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("-"));
  }, []);

  const openAccount = () => {
    if (onOpenAccount) onOpenAccount();
    else onNavigate("settings");
  };

  const switcher = (
    <AccountSwitcher
      accounts={accounts}
      active={activeAccount}
      syncStatus={syncStatus}
      onSwitch={onSwitchAccount}
      onAdd={onAddAccount}
      onConnectSelfhost={onConnectSelfhost}
      onConnectSelfhostBrowser={onConnectSelfhostBrowser}
      onConnectPersonalCloud={onConnectPersonalCloud}
      onRemove={onRemoveAccount}
      onCopyFrom={onCopyAccountData}
      onManage={openAccount}
      onSignIn={onSignInForSync}
      onPasswordLogin={onPasswordLogin}
      compact={isMobile}
      variant={!isMobile && uiMode !== "legacy" ? "workbench" : "default"}
    />
  );
  const workbench = !isMobile && uiMode !== "legacy";
  const autoRail = uiMode === "minimal" && viewingTerminal;
  const collapsed = autoRail ? !terminalPeek : sidebarCollapsed;
  const toggleCollapsed = () => {
    if (autoRail) {
      setTerminalPeek((peek) => !peek);
      return;
    }
    const next = !collapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
    } catch {
      // Not persisting the rail state is harmless.
    }
  };
  const toggleRef = useRef(toggleCollapsed);
  toggleRef.current = toggleCollapsed;

  // Ctrl+B folds the workbench sidebar to a rail and back.
  useEffect(() => {
    if (!workbench) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        const target = e.target as HTMLElement | null;
        // Ctrl+B is "back one character" in the shell; leave it to the terminal.
        if (target?.closest(".xterm")) return;
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workbench]);

  if (isMobile) {
    return (
      <div
        className="app-shell-root app-shell-mobile flex h-full select-none flex-col overflow-hidden"
        style={{ background: "var(--bg-base)" }}
      >
        {!immersive && (
          <header
            className="mobile-topbar flex shrink-0 items-center justify-between gap-3 border-b px-4"
            style={{
              background: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
              paddingTop: "max(0.75rem, env(safe-area-inset-top))",
              paddingBottom: "0.75rem",
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Logo size={20} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
                  Azalea
                </div>
                <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                  v{appVersion}
                </div>
              </div>
            </div>
            {switcher}
          </header>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {showTabs && tabBar}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            {sidePanel}
          </div>
        </div>

        {!immersive && (
          <nav
            className="mobile-bottom-nav shrink-0 border-t"
            style={{
              background: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
              paddingBottom: "max(1.35rem, calc(env(safe-area-inset-bottom, 0px) + 0.85rem))",
              paddingTop: "0.35rem",
            }}
          >
            <div className="grid grid-cols-4 gap-1 px-2 pt-1.5">
              {allNav.map((item) => (
                <NavButton
                  key={item.id}
                  {...item}
                  active={activePage === item.id}
                  onNavigate={onNavigate}
                  compact
                />
              ))}
            </div>
          </nav>
        )}
      </div>
    );
  }

  if (workbench) {
    return (
      <div className="app-shell-root wb-app select-none">
        <WorkbenchTitleBar
          onOpenPalette={() => onOpenPalette?.()}
          onHome={() => onNavigate("home")}
          workspaces={workspaces}
          syncStatus={syncStatus}
        />
        <div className="wb-body" data-inspector={inspector ? "true" : undefined}>
          <WorkbenchSidebar
            collapsed={collapsed}
            activePage={viewingTerminal ? null : activePage}
            onNavigate={onNavigate}
            foot={sidebarFoot}
            accountSlot={switcher}
          >
            {sidebarContent}
          </WorkbenchSidebar>

          <main
            className="wb-main"
            data-terminal={viewingTerminal ? "true" : undefined}
            aria-label="Work area"
          >
            {showTabs && tabBar}
            <div className="wb-work">
              {children}
              {sidePanel}
            </div>
            {footer}
            {!viewingTerminal && statusMessage && statusMessage !== "Ready" && (
              <p className="wb-toast" role="status" aria-live="polite">
                {statusMessage}
              </p>
            )}
          </main>
          {inspector}
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-shell-root flex h-full select-none flex-col overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-56 shrink-0 flex-col border-r"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex-1 px-2 py-2.5">
            <div className="space-y-0.5">
              {primaryNav.map((item) => (
                <NavButton
                  key={item.id}
                  {...item}
                  active={activePage === item.id}
                  onNavigate={onNavigate}
                />
              ))}
            </div>

            <div
              className="my-3 mx-2 border-t"
              style={{ borderColor: "var(--border-subtle)" }}
              aria-hidden
            />

            <div className="space-y-0.5">
              {secondaryNav.map((item) => (
                <NavButton
                  key={item.id}
                  {...item}
                  active={activePage === item.id}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>

          <div className="border-t px-2.5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
            {switcher}
            <div className="px-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
              v{appVersion}
            </div>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {showTabs && tabBar}

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            {sidePanel}
          </div>

          {statusMessage && (
            <div
              className="shrink-0 border-t px-4 py-2 text-sm"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
                background: "var(--bg-panel)",
              }}
            >
              {statusMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
