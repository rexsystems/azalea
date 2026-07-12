export interface TerminalSettings {
  selectToCopy: boolean;
  rightClickToPaste: boolean;
  middleClickToPaste: boolean;
  fontSize: number;
}

export const defaultTerminalSettings: TerminalSettings = {
  selectToCopy: true,
  rightClickToPaste: true,
  middleClickToPaste: true,
  fontSize: 14,
};

const STORAGE_KEY = "azalea-terminal-settings";

export function getStoredTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTerminalSettings;
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>;
    return {
      selectToCopy: parsed.selectToCopy ?? defaultTerminalSettings.selectToCopy,
      rightClickToPaste: parsed.rightClickToPaste ?? defaultTerminalSettings.rightClickToPaste,
      middleClickToPaste: parsed.middleClickToPaste ?? defaultTerminalSettings.middleClickToPaste,
      fontSize: clampFontSize(parsed.fontSize ?? defaultTerminalSettings.fontSize),
    };
  } catch {
    return defaultTerminalSettings;
  }
}

export function setStoredTerminalSettings(settings: TerminalSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clampFontSize(size: number): number {
  return Math.min(22, Math.max(11, Math.round(size)));
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

export const connectScreenOptions: { id: ConnectScreenMode; label: string; description: string }[] =
  [
    {
      id: "fancy",
      label: "Connect screen",
      description: "Termius-style loading with connection logs",
    },
    {
      id: "instant",
      label: "Instant terminal",
      description: "Jump straight to the terminal while connecting",
    },
  ];
