import { SquareTerminal, X, type AppIcon } from "../icons";
import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";

export interface WorkbenchTab {
  id: string;
  title: string;
  status: SessionStatus;
  isLocal: boolean;
  splitWithId: string | null;
}

export interface WorkbenchTool {
  id: string;
  icon: AppIcon;
  label: string;
  onClick: () => void;
  /** Toggle tools report their state with aria-pressed. */
  pressed?: boolean;
  /** Popover tools report their state with aria-expanded instead. */
  expanded?: boolean;
  /** Extra text for screen readers and the tooltip, such as an active count. */
  detail?: string;
  /** Small count shown next to the label. */
  badge?: number;
  /** Clicks on this tool must not dismiss the popover it controls. */
  popoverTrigger?: boolean;
}

interface WorkbenchTabsProps {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  tools: WorkbenchTool[];
}

/**
 * Session tabs plus a labeled terminal toolbar. Labels collapse to icons when
 * the strip gets narrow (container query in workbench.css) and are always
 * icon-only in Minimal UI; the accessible name stays the same either way.
 */
export function WorkbenchTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  tools,
}: WorkbenchTabsProps) {
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const splitPair = active?.splitWithId ? new Set([active.id, active.splitWithId]) : null;

  return (
    <div className="wb-tabs">
      <nav className="wb-tab-list" aria-label="Open sessions">
        {tabs.map((tab) => {
          const current = tab.id === activeTabId;
          const inSplit = Boolean(splitPair?.has(tab.id));
          const status = sessionStatusInfo(tab.status);
          return (
            <div
              key={tab.id}
              className="wb-tab"
              data-current={current ? "true" : undefined}
              data-split={inSplit ? "true" : undefined}
            >
              <button
                type="button"
                className="wb-tab-main"
                aria-current={current ? "true" : undefined}
                aria-label={`${tab.title}, ${status.label}${inSplit ? ", in split view" : ""}`}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.isLocal ? (
                  <SquareTerminal size={12} />
                ) : (
                  <span className={`wb-dot wb-dot-${status.tone}`} aria-hidden />
                )}
                <span className="wb-tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                className="wb-tab-close"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close session"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </nav>

      {tools.length > 0 && (
        <div className="wb-tools" role="toolbar" aria-label="Terminal tools">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                className="wb-tool"
                onClick={tool.onClick}
                aria-pressed={tool.pressed}
                aria-expanded={tool.expanded}
                aria-label={tool.detail ? `${tool.label}, ${tool.detail}` : tool.label}
                title={tool.detail ? `${tool.label} (${tool.detail})` : tool.label}
                {...(tool.popoverTrigger ? { "data-azalea-popover-trigger": "" } : {})}
              >
                <Icon size={13} />
                <span className="wb-tool-label" aria-hidden>
                  {tool.label}
                </span>
                {tool.badge != null && tool.badge > 0 && (
                  <span className="wb-tool-badge" aria-hidden>
                    {tool.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
