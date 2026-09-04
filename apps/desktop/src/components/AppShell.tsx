import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { KeyRound, Server, Settings } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import type { SyncStatus } from "../lib/api";
import { maskEmail } from "../lib/utils";
import { PlanBadge } from "./PlanBadge";
import { TitleBar } from "./TitleBar";
import { Logo } from "./Logo";

export type NavPage = "hosts" | "keys" | "settings";

interface AppShellProps {
  children: ReactNode;
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  onSignInForSync?: () => void;
  statusMessage?: string;
  syncStatus?: SyncStatus | null;
  showTabs?: boolean;
  tabBar?: ReactNode;
  sidePanel?: ReactNode;
  hostCount?: number;
  keyCount?: number;
  isMobile?: boolean;
  /** When true on mobile, hide bottom nav for a full-bleed terminal. */
  immersive?: boolean;
}

const navItems: { id: NavPage; label: string; icon: typeof Server }[] = [
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "keys", label: "Keys", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  activePage,
  onNavigate,
  onSignInForSync,
  statusMessage,
  syncStatus,
  showTabs,
  tabBar,
  sidePanel,
  hostCount = 0,
  keyCount = 0,
  isMobile = false,
  immersive = false,
}: AppShellProps) {
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);

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
                  {syncStatus?.logged_in
                    ? syncStatus.email
                      ? maskEmail(syncStatus.email)
                      : "Signed in"
                    : `v${appVersion}`}
                </div>
              </div>
            </div>
            {syncStatus?.logged_in ? (
              <button type="button" onClick={() => onNavigate("settings")}>
                <PlanBadge plan={syncStatus.plan} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (onSignInForSync) onSignInForSync();
                  else onNavigate("settings");
                }}
                className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                Sign in
              </button>
            )}
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
              // Extra lift above Android/iOS gesture bars (safe-area is often 0 in WebView).
              paddingBottom: "max(1.35rem, calc(env(safe-area-inset-bottom, 0px) + 0.85rem))",
              paddingTop: "0.35rem",
            }}
          >
            <div className="grid grid-cols-3 gap-1 px-2 pt-1.5">
              {navItems.map(({ id, label, icon: Icon }) => {
                const active = activePage === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onNavigate(id)}
                    className="transition-ui flex flex-col items-center gap-1 rounded-xl px-2 py-2"
                    style={{
                      background: active ? "var(--nav-active)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                    <span className="text-[10px] font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
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
          <div className="flex-1 space-y-0.5 px-2 py-2.5">
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
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
                  {id === "keys" ? "Keychain" : label}
                </button>
              );
            })}

            <div
              className="mt-4 space-y-1.5 rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
            >
              <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Library
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-secondary)" }}>Hosts</span>
                <span className="font-medium tabular-nums" style={{ color: "var(--text)" }}>
                  {hostCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "var(--text-secondary)" }}>Keys</span>
                <span className="font-medium tabular-nums" style={{ color: "var(--text)" }}>
                  {keyCount}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
            {syncStatus?.logged_in ? (
              <>
                <div className="mb-1.5 truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                  {syncStatus.email ? maskEmail(syncStatus.email) : "Signed in"}
                </div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <PlanBadge plan={syncStatus.plan} />
                  <button
                    type="button"
                    onClick={() => onNavigate("settings")}
                    className="text-[10px] transition-opacity hover:opacity-80"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Account
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (onSignInForSync) onSignInForSync();
                  else onNavigate("settings");
                }}
                className="mb-2 w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-ui hover-subtle"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
              >
                Sign in for cloud sync
              </button>
            )}
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
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
