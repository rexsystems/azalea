import { getStoredTheme, type ThemeId } from "./theme";

/**
 * Interface layout. "new" is the default for every install, including
 * existing ones: their legacy theme stays stored, so switching back to
 * "legacy" restores the old look exactly.
 */
export type UiMode = "new" | "legacy" | "minimal";

/** Color scheme for the new and minimal interfaces. */
export type UiThemeId = "ink" | "paper" | "system";

/** Theme actually written to `data-theme` when a non-legacy mode is active. */
export type ResolvedUiTheme = "ink" | "paper";

export const UI_MODE_KEY = "azalea-ui-mode";
export const UI_THEME_KEY = "azalea-ui-theme";
/** Fired on window after the mode or a theme changes, so hooks in other trees can follow. */
export const APPEARANCE_EVENT = "azalea-appearance";

export const uiModes: { id: UiMode; label: string; description: string }[] = [
  {
    id: "new",
    label: "New",
    description: "Sidebar with sessions and hosts, labeled tools, one side panel.",
  },
  {
    id: "minimal",
    label: "Minimal UI",
    description: "Same layout with dense rows and icon tools. The sidebar folds away while a terminal is open.",
  },
  {
    id: "legacy",
    label: "Legacy UI",
    description: "The previous layout and themes, unchanged.",
  },
];

export const uiThemes: { id: UiThemeId; label: string; description: string; preview: [string, string] }[] = [
  { id: "ink", label: "Ink", description: "Dark", preview: ["#0F0F12", "#A898FF"] },
  { id: "paper", label: "Paper", description: "Light", preview: ["#FAFAF8", "#372882"] },
  { id: "system", label: "Match system", description: "Follows the OS setting", preview: ["#0F0F12", "#FAFAF8"] },
];

const LIGHT_LEGACY_THEMES: ReadonlySet<ThemeId> = new Set(["white", "snow", "pearl"]);

export function isUiMode(value: unknown): value is UiMode {
  return value === "new" || value === "legacy" || value === "minimal";
}

export function isUiTheme(value: unknown): value is UiThemeId {
  return value === "ink" || value === "paper" || value === "system";
}

export function parseUiMode(raw: string | null): UiMode {
  return isUiMode(raw) ? raw : "new";
}

/**
 * First run of the new interface on an existing install: carry over whether
 * the person picked a light or dark legacy theme instead of forcing dark.
 */
export function parseUiTheme(raw: string | null, legacyTheme: ThemeId): UiThemeId {
  if (isUiTheme(raw)) return raw;
  return LIGHT_LEGACY_THEMES.has(legacyTheme) ? "paper" : "ink";
}

export function resolveUiTheme(id: UiThemeId, prefersDark: boolean): ResolvedUiTheme {
  if (id === "system") return prefersDark ? "ink" : "paper";
  return id;
}

export function documentTheme(
  mode: UiMode,
  legacyTheme: ThemeId,
  uiTheme: UiThemeId,
  prefersDark: boolean,
): ThemeId | ResolvedUiTheme {
  return mode === "legacy" ? legacyTheme : resolveUiTheme(uiTheme, prefersDark);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the choice still applies for this session */
  }
}

export function getStoredUiMode(): UiMode {
  return parseUiMode(readStorage(UI_MODE_KEY));
}

export function getStoredUiTheme(): UiThemeId {
  return parseUiTheme(readStorage(UI_THEME_KEY), getStoredTheme());
}

export function prefersDarkScheme(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Writes `data-ui` and `data-theme` on <html> from what is stored. */
export function applyAppearance() {
  const mode = getStoredUiMode();
  const root = document.documentElement;
  root.dataset.ui = mode;
  root.dataset.theme = documentTheme(mode, getStoredTheme(), getStoredUiTheme(), prefersDarkScheme());
}

export function notifyAppearanceChanged() {
  applyAppearance();
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT));
}

export function setStoredUiMode(mode: UiMode) {
  writeStorage(UI_MODE_KEY, mode);
  notifyAppearanceChanged();
}

export function setStoredUiTheme(id: UiThemeId) {
  writeStorage(UI_THEME_KEY, id);
  notifyAppearanceChanged();
}

/**
 * Keeps <html> in sync with the OS color scheme (for "Match system") and with
 * other windows such as pop-out terminals, which share localStorage.
 */
export function watchAppearance(): () => void {
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const onScheme = () => notifyAppearanceChanged();
  const onStorage = (event: StorageEvent) => {
    if (event.key === UI_MODE_KEY || event.key === UI_THEME_KEY || event.key === "azalea-theme") {
      notifyAppearanceChanged();
    }
  };
  media?.addEventListener("change", onScheme);
  window.addEventListener("storage", onStorage);
  return () => {
    media?.removeEventListener("change", onScheme);
    window.removeEventListener("storage", onStorage);
  };
}
