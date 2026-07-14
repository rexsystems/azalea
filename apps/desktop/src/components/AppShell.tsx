import type { ReactNode } from "react";
import { Folder, KeyRound, Server, Settings } from "lucide-react";
import { TitleBar } from "./TitleBar";

export type NavPage = "hosts" | "groups" | "keys" | "settings";

interface AppShellProps {
  children: ReactNode;
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  statusMessage?: string;
  showTabs?: boolean;
  tabBar?: ReactNode;
  sidePanel?: ReactNode;
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
  showTabs,
  tabBar,
  sidePanel,
}: AppShellProps) {
  return (
    <div className="app-shell-root flex h-full select-none flex-col" style={{ background: "var(--bg-base)" }}>
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <nav
          className="flex w-[200px] shrink-0 flex-col border-r"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="flex-1 px-2 py-2">
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  className={`transition-ui flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                    active ? "" : "hover-subtle"
                  }`}
                  style={{
                    background: active ? "var(--nav-active)" : "transparent",
                    color: active ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <Icon size={16} strokeWidth={active ? 2 : 1.5} />
                  {label}
                </button>
              );
            })}
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
              className="shrink-0 border-t px-4 py-1.5 text-xs"
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
