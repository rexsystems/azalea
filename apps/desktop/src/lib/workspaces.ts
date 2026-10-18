export interface WorkspaceTab {
  hostId: string;
  local: boolean;
  splitWith: number | null;
}

export interface SavedWorkspace {
  id: string;
  name: string;
  tabs: WorkspaceTab[];
  activeTab: number;
  splitRatio: number;
}

export function workspaceStorageKey(accountId: string): string {
  return `azalea:workspaces:v1:${accountId}`;
}

export function parseWorkspaces(raw: string | null): SavedWorkspace[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Invalid workspace data");
  return data.filter((value): value is SavedWorkspace => {
    if (!value || typeof value !== "object") return false;
    const w = value as SavedWorkspace;
    return typeof w.id === "string" && typeof w.name === "string" && !!w.name.trim()
      && Array.isArray(w.tabs) && w.tabs.length > 0
      && Number.isInteger(w.activeTab) && w.activeTab >= 0 && w.activeTab < w.tabs.length
      && typeof w.splitRatio === "number" && w.splitRatio >= 0.2 && w.splitRatio <= 0.8
      && w.tabs.every((tab, i) => tab && typeof tab.hostId === "string"
        && typeof tab.local === "boolean"
        && (tab.splitWith === null || (Number.isInteger(tab.splitWith)
          && tab.splitWith >= 0 && tab.splitWith < w.tabs.length && tab.splitWith !== i
          && w.tabs[tab.splitWith]?.splitWith === i)));
  });
}

export function captureWorkspace(
  tabs: { id: string; hostId: string; splitWithId?: string; poppedOut?: boolean }[],
  activeTabId: string | null,
  splitRatio: number,
  isLocal: (id: string) => boolean,
): Pick<SavedWorkspace, "tabs" | "activeTab" | "splitRatio"> {
  const visible = tabs.filter((tab) => !tab.poppedOut);
  return {
    tabs: visible.map((tab) => {
      const mate = visible.findIndex((candidate) => candidate.id === tab.splitWithId);
      return { hostId: tab.hostId, local: isLocal(tab.id), splitWith: mate >= 0 ? mate : null };
    }),
    activeTab: Math.max(0, visible.findIndex((tab) => tab.id === activeTabId)),
    splitRatio: Math.min(0.8, Math.max(0.2, splitRatio)),
  };
}
