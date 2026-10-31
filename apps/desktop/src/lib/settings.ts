import { isTerminalPaletteId, type TerminalPaletteId } from "./terminalPalettes";

export interface TerminalSettings {
  selectToCopy: boolean;
  rightClickToPaste: boolean;
  fontSize: number;
  /** Color scheme in the New and Minimal interfaces. Legacy keeps its own. */
  palette: TerminalPaletteId;
  fontFamily: TerminalFontId;
}

/**
 * "nerd" prefers an installed Nerd Font so prompt icons render, then falls
 * back to the bundled JetBrains Mono. "jetbrains" always uses the bundled font.
 */
export type TerminalFontId = "nerd" | "jetbrains" | "system";

export const terminalFonts: { id: TerminalFontId; label: string }[] = [
  { id: "nerd", label: "Nerd Font, then JetBrains Mono" },
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "system", label: "System monospace" },
];

function isTerminalFontId(value: unknown): value is TerminalFontId {
  return value === "nerd" || value === "jetbrains" || value === "system";
}

export const defaultTerminalSettings: TerminalSettings = {
  selectToCopy: true,
  rightClickToPaste: true,
  fontSize: 16,
  palette: "azalea",
  fontFamily: "nerd",
};

const STORAGE_KEY = "azalea-terminal-settings";

/** New and Minimal use a denser 13px terminal; Legacy keeps its 16px default. */
function defaultTerminalFontSize(): number {
  const ui = document.documentElement.dataset.ui;
  return ui === "new" || ui === "minimal" ? 13 : defaultTerminalSettings.fontSize;
}

/** Defaults for the interface in use. Read after the appearance is applied. */
export function currentDefaultTerminalSettings(): TerminalSettings {
  return { ...defaultTerminalSettings, fontSize: defaultTerminalFontSize() };
}

export function getStoredTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return currentDefaultTerminalSettings();
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
    return {
      selectToCopy: parsed.selectToCopy ?? defaultTerminalSettings.selectToCopy,
      rightClickToPaste: parsed.rightClickToPaste ?? defaultTerminalSettings.rightClickToPaste,
      fontSize: clampFontSize(parsed.fontSize ?? defaultTerminalFontSize()),
      palette: isTerminalPaletteId(parsed.palette)
        ? parsed.palette
        : defaultTerminalSettings.palette,
      fontFamily: isTerminalFontId(parsed.fontFamily)
        ? parsed.fontFamily
        : defaultTerminalSettings.fontFamily,
    };
  } catch {
    return currentDefaultTerminalSettings();
  }
}

export function setStoredTerminalSettings(settings: TerminalSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clampFontSize(size: number): number {
  return Math.min(26, Math.max(12, Math.round(size)));
}

export type ConnectScreenMode = "fancy" | "instant";

const CONNECT_STORAGE_KEY = "azalea-connect-screen";

export function getStoredConnectScreen(): ConnectScreenMode {
  const stored = localStorage.getItem(CONNECT_STORAGE_KEY);
  if (stored === "fancy" || stored === "instant") return stored;
  return "fancy";
}

export function setStoredConnectScreen(mode: ConnectScreenMode) {
  localStorage.setItem(CONNECT_STORAGE_KEY, mode);
}

const AUTO_SYNC_KEY = "azalea-auto-sync";

export function getStoredAutoSync(): boolean {
  return localStorage.getItem(AUTO_SYNC_KEY) === "1";
}

export function setStoredAutoSync(enabled: boolean) {
  localStorage.setItem(AUTO_SYNC_KEY, enabled ? "1" : "0");
}

// ---------- Gravatar (privacy opt-in) ----------

const GRAVATAR_KEY = "azalea-gravatar-enabled";

/**
 * Gravatar shows an avatar by sending a SHA-256 of the user's email to
 * gravatar.com every time the app renders <UserAvatar>. That leaks the
 * email hash to a third party, which trivially rounds down to "did user X
 * open Azalea today?". Default OFF; user must explicitly opt in from
 * Settings.
 */
export function getStoredGravatarEnabled(): boolean {
  return localStorage.getItem(GRAVATAR_KEY) === "1";
}

export function setStoredGravatarEnabled(enabled: boolean) {
  localStorage.setItem(GRAVATAR_KEY, enabled ? "1" : "0");
}

// ---------- Host card address privacy ----------

const HIDE_HOST_ADDRESSES_KEY = "azalea-hide-host-addresses";

/** When on, host cards show username only (no hostname/IP). */
export function getStoredHideHostAddresses(): boolean {
  return localStorage.getItem(HIDE_HOST_ADDRESSES_KEY) === "1";
}

export function setStoredHideHostAddresses(enabled: boolean) {
  localStorage.setItem(HIDE_HOST_ADDRESSES_KEY, enabled ? "1" : "0");
}

export const connectScreenOptions: { id: ConnectScreenMode; label: string; description: string }[] =
  [
    {
      id: "fancy",
      label: "Connect screen",
      description: "Animated loading screen with connection logs",
    },
    {
      id: "instant",
      label: "Instant terminal",
      description: "Open the terminal while the session connects",
    },
  ];
