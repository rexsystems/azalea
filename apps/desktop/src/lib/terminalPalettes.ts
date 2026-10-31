/**
 * Terminal color schemes for the New and Minimal interfaces. They are chosen
 * apart from the app theme, so a light terminal can sit in a dark window.
 * "azalea" follows the app theme; the others are fixed.
 */
import type { ITheme } from "@xterm/xterm";

export type TerminalPaletteId = "azalea" | "ocean" | "ember" | "forest" | "solarized-light";

export interface TerminalPalette {
  id: TerminalPaletteId;
  label: string;
  theme: ITheme;
}

const INK: ITheme = {
  background: "#0b0b0e",
  foreground: "#ececf1",
  cursor: "#a898ff",
  cursorAccent: "#0b0b0e",
  selectionBackground: "#a898ff40",
  black: "#1e1e24",
  red: "#f28b82",
  green: "#7fd19b",
  yellow: "#e5c07b",
  blue: "#8ab4ff",
  magenta: "#c3b5ff",
  cyan: "#7dd3d8",
  white: "#d4d4dc",
  brightBlack: "#8c8c99",
  brightRed: "#f7aaa3",
  brightGreen: "#a3e2b8",
  brightYellow: "#f0d49c",
  brightBlue: "#adcbff",
  brightMagenta: "#ddd2ff",
  brightCyan: "#a5e3e6",
  brightWhite: "#ffffff",
};

/** Light terminal: every ANSI color reaches 4.5:1 on white. */
const PAPER: ITheme = {
  background: "#ffffff",
  foreground: "#17171c",
  cursor: "#372882",
  cursorAccent: "#ffffff",
  selectionBackground: "#37288233",
  black: "#17171c",
  red: "#c0392b",
  green: "#17804f",
  yellow: "#946200",
  blue: "#2b54c4",
  magenta: "#7a3db8",
  cyan: "#0f6e75",
  white: "#4e4e58",
  brightBlack: "#686873",
  brightRed: "#a3281c",
  brightGreen: "#0f6a41",
  brightYellow: "#764e00",
  brightBlue: "#2448ad",
  brightMagenta: "#6a33a3",
  brightCyan: "#0b5f65",
  brightWhite: "#17171c",
};

const OCEAN: ITheme = {
  background: "#0b1a24",
  foreground: "#e6f1f8",
  cursor: "#58a6ff",
  cursorAccent: "#0b1a24",
  selectionBackground: "#58a6ff40",
  black: "#12283a",
  red: "#ff7b72",
  green: "#56d364",
  yellow: "#e3b341",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#c9d9e6",
  brightBlack: "#7d93a8",
  brightRed: "#ffa198",
  brightGreen: "#7ee787",
  brightYellow: "#f2cc60",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#ffffff",
};

const EMBER: ITheme = {
  background: "#1a120c",
  foreground: "#faf3eb",
  cursor: "#ffca6b",
  cursorAccent: "#1a120c",
  selectionBackground: "#ff8a6540",
  black: "#2a1e16",
  red: "#ff8a65",
  green: "#a5d66f",
  yellow: "#ffca6b",
  blue: "#7fb2ff",
  magenta: "#e39aff",
  cyan: "#6fd3c5",
  white: "#e9dccf",
  brightBlack: "#9a7b66",
  brightRed: "#ffab91",
  brightGreen: "#c5e8a0",
  brightYellow: "#ffdc9c",
  brightBlue: "#a8cbff",
  brightMagenta: "#eebbff",
  brightCyan: "#9be3d9",
  brightWhite: "#ffffff",
};

const FOREST: ITheme = {
  background: "#0e1712",
  foreground: "#ecfdf3",
  cursor: "#4ade80",
  cursorAccent: "#0e1712",
  selectionBackground: "#4ade8040",
  black: "#18261d",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#93c5fd",
  magenta: "#c084fc",
  cyan: "#2dd4bf",
  white: "#d5eadd",
  brightBlack: "#6b9b7c",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#bfdbfe",
  brightMagenta: "#d8b4fe",
  brightCyan: "#5eead4",
  brightWhite: "#ffffff",
};

/** Solarized light with the darker accents, so text stays at 4.5:1 or more. */
const SOLARIZED_LIGHT: ITheme = {
  background: "#fdf6e3",
  foreground: "#3b4b52",
  cursor: "#268bd2",
  cursorAccent: "#fdf6e3",
  selectionBackground: "#268bd233",
  black: "#073642",
  red: "#c0302d",
  green: "#5f6e00",
  yellow: "#856300",
  blue: "#1d6aa3",
  magenta: "#55599e",
  cyan: "#1a7a72",
  white: "#586e75",
  brightBlack: "#5f6f75",
  brightRed: "#a8361a",
  brightGreen: "#4f5c00",
  brightYellow: "#6e5300",
  brightBlue: "#185a8c",
  brightMagenta: "#4a4d8a",
  brightCyan: "#15665f",
  brightWhite: "#002b36",
};

/** `data-theme` values that use a light window. */
export function isLightUiTheme(theme: string | undefined): boolean {
  return theme === "paper";
}

export function terminalPalettes(lightWindow: boolean): TerminalPalette[] {
  return [
    {
      id: "azalea",
      label: lightWindow ? "Azalea Paper" : "Azalea Ink",
      theme: lightWindow ? PAPER : INK,
    },
    { id: "ocean", label: "Ocean", theme: OCEAN },
    { id: "ember", label: "Ember", theme: EMBER },
    { id: "forest", label: "Forest", theme: FOREST },
    { id: "solarized-light", label: "Solarized light", theme: SOLARIZED_LIGHT },
  ];
}

export function isTerminalPaletteId(value: unknown): value is TerminalPaletteId {
  return (
    value === "azalea" ||
    value === "ocean" ||
    value === "ember" ||
    value === "forest" ||
    value === "solarized-light"
  );
}

/** xterm theme for a palette under the current window theme. */
export function terminalPaletteTheme(id: TerminalPaletteId, lightWindow: boolean): ITheme {
  const found = terminalPalettes(lightWindow).find((p) => p.id === id);
  return (found ?? terminalPalettes(lightWindow)[0]).theme;
}

/** Six swatch colors shown beside a palette name. */
export function paletteSwatches(theme: ITheme): string[] {
  return [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan].map(
    (c) => c ?? "transparent",
  );
}
