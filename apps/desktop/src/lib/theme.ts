export type ThemeId = "midnight" | "lilac" | "graphite" | "ocean" | "noir";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  preview: string;
}

export const themes: ThemeDefinition[] = [
  { id: "midnight", name: "Midnight", preview: "#3d4556" },
  { id: "lilac", name: "Lilac", preview: "#7c3aed" },
  { id: "graphite", name: "Graphite", preview: "#52525b" },
  { id: "ocean", name: "Ocean", preview: "#0891b2" },
  { id: "noir", name: "Noir", preview: "#0a0a0a" },
];

const STORAGE_KEY = "azalea-theme";

export function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && themes.some((t) => t.id === stored)) {
    return stored as ThemeId;
  }
  return "midnight";
}

export function setStoredTheme(id: ThemeId) {
  localStorage.setItem(STORAGE_KEY, id);
  document.documentElement.dataset.theme = id;
}

export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
}

export const hostIconColors = [
  { bg: "#c0392b", label: "red" },
  { bg: "#e67e22", label: "orange" },
  { bg: "#2980b9", label: "blue" },
  { bg: "#27ae60", label: "green" },
  { bg: "#8e44ad", label: "purple" },
  { bg: "#16a085", label: "teal" },
  { bg: "#d35400", label: "rust" },
  { bg: "#2c3e50", label: "slate" },
];

export function getHostIconColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hostIconColors[Math.abs(hash) % hostIconColors.length].bg;
}
