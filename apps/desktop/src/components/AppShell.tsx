import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Folder, KeyRound, Server, Settings } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import type { SyncStatus } from "../lib/api";
import { maskEmail } from "../lib/utils";
import { PlanBadge } from "./PlanBadge";
import { TitleBar } from "./TitleBar";

export type NavPage = "hosts" | "groups" | "keys" | "settings";

interface AppShellProps {
  children: ReactNode;
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  statusMessage?: string;
  syncStatus?: SyncStatus | null;
  showTabs?: boolean;
  tabBar?: ReactNode;
  sidePanel?: ReactNode;
  hostCount?: number;
  keyCount?: number;
}

const navItems: { id: NavPage; label: string; icon: typeof Server }[] = [
  { id: "hosts", label: "Hosts", icon: Server },
  { id: "groups", label: "Groups", icon: Folder },
  { id: "keys", label: "Keychain", icon: KeyRound },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  activePage,
  onNavigate,
  statusMessage,
  syncStatus,
  showTabs,
  tabBar,
  sidePanel,
  hostCount = 0,
  keyCount = 0,
}: AppShellProps) {
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);

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
                  {label}
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
                onClick={() => onNavigate("settings")}
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
