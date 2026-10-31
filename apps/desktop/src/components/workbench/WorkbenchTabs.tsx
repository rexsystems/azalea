import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";
import { WbClose, WbPlus, WbTerminal, type WbIcon } from "./wbIcons";

export interface WorkbenchTab {
  id: string;
  title: string;
  status: SessionStatus;
  isLocal: boolean;
  splitWithId: string | null;
}

export interface WorkbenchTool {
  id: string;
  icon: WbIcon;
  label: string;
  onClick: () => void;
  /** Keyboard shortcut shown in the tooltip, such as "Ctrl Shift F". */
  shortcut?: string;
  /** Draw only the icon; the label stays as the accessible name. */
  iconOnly?: boolean;
  /** Draw a divider before this tool. */
  separatorBefore?: boolean;
  /** Toggle tools report their state with aria-pressed. */
  pressed?: boolean;
  /** Popover tools report their state with aria-expanded instead. */
  expanded?: boolean;
  /** Extra text for screen readers and the tooltip, such as an active count. */
  detail?: string;
  /** Clicks on this tool must not dismiss the popover it controls. */
  popoverTrigger?: boolean;
}

interface WorkbenchTabsProps {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  tools: WorkbenchTool[];
}

function toolTitle(tool: WorkbenchTool): string {
  const base = tool.detail ? `${tool.label}, ${tool.detail}` : tool.label;
  return tool.shortcut ? `${base} (${tool.shortcut})` : base;
}

/**
 * Session tabs plus the terminal toolbar. With the inspector open the labels
 * of inactive tools collapse to icons (workbench.css); the accessible name
 * stays the same either way.
 */
export function WorkbenchTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
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
              data-on={current ? "true" : undefined}
              data-split={inSplit ? "true" : undefined}
              data-local={tab.isLocal ? "true" : undefined}
            >
              <button
                type="button"
                className="wb-tab-main"
                aria-current={current ? "true" : undefined}
                aria-label={`${tab.title}, ${status.label}${inSplit ? ", in split view" : ""}`}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.isLocal ? (
                  <WbTerminal />
                ) : (
                  <span className={`wb-dot ${status.tone}`} aria-hidden />
                )}
                <span className="wb-tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                className="wb-tab-x"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close ${tab.title}`}
                title="Close session"
              >
                <WbClose />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="wb-tab-new"
          onClick={onNewTab}
          aria-label="New local terminal"
          title="New local terminal"
        >
          <WbPlus />
        </button>
      </nav>

      {tools.length > 0 && (
        <div className="wb-tools" role="toolbar" aria-label="Terminal tools">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const on = Boolean(tool.pressed || tool.expanded);
            return (
              <span key={tool.id} className="wb-tool-slot">
                {tool.separatorBefore && <span className="wb-sep" aria-hidden />}
                <button
                  type="button"
                  className="wb-tool"
                  data-on={on ? "true" : undefined}
                  data-icon-only={tool.iconOnly ? "true" : undefined}
                  onClick={tool.onClick}
                  aria-pressed={tool.pressed}
                  aria-expanded={tool.expanded}
                  aria-label={tool.detail ? `${tool.label}, ${tool.detail}` : tool.label}
                  aria-keyshortcuts={tool.shortcut?.replace(/ /g, "+").replace("Ctrl", "Control")}
                  title={toolTitle(tool)}
                  {...(tool.popoverTrigger ? { "data-azalea-popover-trigger": "" } : {})}
                >
                  <Icon />
                  {!tool.iconOnly && (
                    <span className="wb-tool-label" aria-hidden>
                      {tool.label}
                    </span>
                  )}
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
