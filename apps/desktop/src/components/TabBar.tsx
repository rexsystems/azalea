import { LayoutGrid, X } from "lucide-react";

interface TabBarProps {
  tabs: { id: string; title: string; status: string }[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onBrowse: () => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onBrowse }: TabBarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
        minHeight: "44px",
      }}
    >
      <button
        onClick={onBrowse}
        className="hover-subtle transition-ui mr-1 flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm"
        style={{ color: "var(--text-muted)" }}
        title="Browse hosts"
      >
        <LayoutGrid size={15} />
        Hosts
      </button>

      <div
        className="mx-1 h-5 w-px shrink-0"
        style={{ background: "var(--border-subtle)" }}
      />

      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const dotColor =
          tab.status === "connected"
            ? "#4ade80"
            : tab.status === "connecting"
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
              className="hover-subtle mr-1 shrink-0 rounded-md p-1.5 opacity-50 group-hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
              aria-label={`Close ${tab.title}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
