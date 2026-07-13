import type { ReactNode } from "react";
import { X } from "lucide-react";

interface TabBarProps {
  tabs: { id: string; title: string; status: string }[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  actions?: ReactNode;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, actions }: TabBarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
        minHeight: "44px",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const dotColor =
          tab.status === "connected"
            ? "#4ade80"
            : tab.status === "connecting" || tab.status === "reconnecting"
              ? "#fbbf24"
              : tab.status === "error"
                ? "#f87171"
                : "var(--text-muted)";

        return (
          <div
            key={tab.id}
            className={`transition-ui group flex shrink-0 items-center rounded-lg text-sm ${
              active ? "hover-subtle-active" : "hover-subtle"
            }`}
            style={{
              background: active ? "var(--bg-card)" : "transparent",
              color: active ? "var(--text)" : "var(--text-muted)",
              border: active ? "1px solid var(--border-subtle)" : "1px solid transparent",
            }}
          >
            <button
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />
              <span className="max-w-[200px] truncate font-medium">{tab.title}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="hover-subtle mr-1.5 shrink-0 rounded p-0.5 opacity-50 group-hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
              aria-label={`Close ${tab.title}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">{actions}</div>}
    </div>
  );
}
