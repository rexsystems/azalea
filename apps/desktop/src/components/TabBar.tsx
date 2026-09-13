import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, SquareTerminal, X } from "./icons";
import { isLocalSession } from "../lib/api";

export interface TabBarTab {
  id: string;
  title: string;
  status: string;
  /** Other tab id in the active split pair, if any. */
  splitWithId?: string | null;
}

interface TabBarProps {
  tabs: TabBarTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  actions?: ReactNode;
  isMobile?: boolean;
  onBack?: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  actions,
  isMobile = false,
  onBack,
}: TabBarProps) {
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const splitPair =
    active?.splitWithId != null
      ? new Set([active.id, active.splitWithId])
      : null;

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2.5 py-2"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
        minHeight: isMobile ? "3.25rem" : "3rem",
        paddingTop: isMobile ? "max(0.5rem, env(safe-area-inset-top))" : undefined,
      }}
    >
      {isMobile && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="hover-subtle transition-ui mr-0.5 shrink-0 rounded-lg p-2"
          style={{ color: "var(--text)" }}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
      )}

      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const local = isLocalSession(tab.id);
        const inSplit = Boolean(splitPair?.has(tab.id));
        const prev = tabs[index - 1];
        const next = tabs[index + 1];
        const splitWithPrev =
          inSplit && prev != null && splitPair?.has(prev.id) === true;
        const splitWithNext =
          inSplit && next != null && splitPair?.has(next.id) === true;
        const dotColor =
          tab.status === "connected"
            ? "#4ade80"
            : tab.status === "connecting" || tab.status === "reconnecting"
              ? "#fbbf24"
              : tab.status === "error"
                ? "#f87171"
                : "var(--text-muted)";

        const tabStyle: CSSProperties = {
          background: isActive || inSplit ? "var(--bg-card)" : "transparent",
          color: isActive ? "var(--text)" : "var(--text-muted)",
          border: isActive || inSplit ? "1px solid var(--border-subtle)" : "1px solid transparent",
          borderTopLeftRadius: splitWithPrev ? 0 : undefined,
          borderBottomLeftRadius: splitWithPrev ? 0 : undefined,
          borderTopRightRadius: splitWithNext ? 0 : undefined,
          borderBottomRightRadius: splitWithNext ? 0 : undefined,
          marginLeft: splitWithPrev ? -1 : undefined,
        };

        return (
          <div
            key={tab.id}
            className={`transition-ui group flex shrink-0 items-center rounded-lg text-sm ${
              isActive ? "hover-subtle-active" : "hover-subtle"
            }`}
            style={tabStyle}
          >
            <button
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1.5"
            >
              {local ? (
                <SquareTerminal
                  size={14}
                  strokeWidth={1.75}
                  style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }}
                />
              ) : (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: dotColor }}
                />
              )}
              <span
                className={`truncate font-medium ${isMobile ? "max-w-[120px]" : "max-w-[220px]"}`}
              >
                {tab.title}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className={`hover-subtle mr-1.5 shrink-0 rounded p-0.5 ${
                isMobile ? "opacity-80" : "opacity-50 group-hover:opacity-80"
              }`}
              style={{ color: "var(--text-muted)" }}
              aria-label={`Close ${tab.title}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">{actions}</div>}
    </div>
  );
}
