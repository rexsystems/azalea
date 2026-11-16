export type LayoutId = "command" | "columns" | "classic";

export interface LayoutDefinition {
  id: LayoutId;
  name: string;
  description: string;
}

export const layouts: LayoutDefinition[] = [
  {
    id: "command",
    name: "Command",
    description: "One top bar with navigation and session tabs. Home is a launcher.",
  },
  {
    id: "columns",
    name: "Columns",
    description: "Icon rail, host list always visible, details on the right.",
  },
  {
    id: "classic",
    name: "Classic",
    description: "Sidebar with labels, cards on the pages.",
  },
];

const STORAGE_KEY = "azalea-layout";

export function getStoredLayout(): LayoutId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && layouts.some((l) => l.id === stored)) return stored as LayoutId;
  } catch {
    // Storage can be blocked; the default layout is fine.
  }
  return "command";
}

export function applyLayout(id: LayoutId) {
  document.documentElement.dataset.layout = id;
}

export function setStoredLayout(id: LayoutId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not persisted, still applied for this session.
  }
  applyLayout(id);
}
