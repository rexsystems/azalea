export type ThemeId =
  | "noir"
  | "dark"
  | "midnight"
  | "graphite"
  | "ocean"
  | "lilac"
  | "ember"
  | "forest"
  | "rose"
  | "white"
  | "snow"
  | "pearl";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  preview: string;
}

export const themes: ThemeDefinition[] = [
  { id: "noir", name: "Noir", preview: "#0a0a0a" },
  { id: "dark", name: "Dark", preview: "#1c1c1e" },
  { id: "midnight", name: "Midnight", preview: "#3d4556" },
  { id: "graphite", name: "Graphite", preview: "#52525b" },
  { id: "ocean", name: "Ocean", preview: "#0891b2" },
  { id: "lilac", name: "Lilac", preview: "#7c3aed" },
  { id: "ember", name: "Ember", preview: "#d97706" },
  { id: "forest", name: "Forest", preview: "#166534" },
  { id: "rose", name: "Rose", preview: "#e11d48" },
  { id: "white", name: "White", preview: "#ffffff" },
  { id: "snow", name: "Snow", preview: "#c7d7f0" },
  { id: "pearl", name: "Pearl", preview: "#f3ebe3" },
];

const STORAGE_KEY = "azalea-theme";

export function getStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "glossy") return "midnight";
  if (stored && themes.some((t) => t.id === stored)) {
    return stored as ThemeId;
  }
  return "noir";
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
