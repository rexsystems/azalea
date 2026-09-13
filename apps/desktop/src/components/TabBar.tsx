import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, SquareTerminal, X } from "./icons";
import { HostOsIcon } from "./HostOsIcon";
import { isLocalSession } from "../lib/api";

export interface TabBarTab {
  id: string;
  title: string;
  status: string;
  osId?: string | null;
  hostId?: string | null;
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

function statusRing(status: string): string {
  if (status === "connected") return "#4ade80";
  if (status === "connecting" || status === "reconnecting") return "#fbbf24";
  if (status === "error") return "#f87171";
  return "var(--text-muted)";
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
        const ring = statusRing(tab.status);
        const glow = inSplit
          ? isActive
            ? `0 0 12px color-mix(in srgb, ${ring} 45%, transparent), inset 0 -2px 0 0 ${ring}`
            : `0 0 8px color-mix(in srgb, ${ring} 22%, transparent)`
          : isActive
            ? `inset 0 -2px 0 0 ${ring}`
            : undefined;

        const tabStyle: CSSProperties = {
          background: isActive || inSplit ? "var(--bg-card)" : "transparent",
          color: isActive ? "var(--text)" : "var(--text-muted)",
          border: isActive || inSplit ? `1px solid color-mix(in srgb, ${ring} 35%, var(--border-subtle))` : "1px solid transparent",
          boxShadow: glow,
          borderTopLeftRadius: splitWithPrev ? 0 : undefined,
          borderBottomLeftRadius: splitWithPrev ? 0 : undefined,
          borderTopRightRadius: splitWithNext ? 0 : undefined,
          borderBottomRightRadius: splitWithNext ? 0 : undefined,
          marginLeft: splitWithPrev ? -6 : undefined,
        };

        return (
          <div key={tab.id} className="relative flex shrink-0 items-center">
            {splitWithPrev && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-1/2 z-[1] h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  background: `radial-gradient(circle, color-mix(in srgb, ${ring} 70%, transparent) 0%, transparent 70%)`,
                  boxShadow: `0 0 10px color-mix(in srgb, ${ring} 55%, transparent)`,
                }}
              />
            )}
            <div
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
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md"
                    style={{
                      boxShadow: `0 0 0 1.5px ${ring}`,
                      color: isActive ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    <SquareTerminal size={12} strokeWidth={1.75} />
                  </span>
                ) : (
                  <span
                    className="flex shrink-0 items-center justify-center rounded-md"
                    style={{ boxShadow: `0 0 0 1.5px ${ring}` }}
                    title={tab.status}
                  >
                    <HostOsIcon
                      osId={tab.osId}
                      seed={tab.hostId || tab.id}
                      size={18}
                      rounded={5}
                    />
                  </span>
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
          </div>
        );
      })}

      {actions && <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-2">{actions}</div>}
    </div>
  );
}
