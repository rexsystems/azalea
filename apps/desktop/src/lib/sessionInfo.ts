/**
 * Small parsers behind the workbench footer and title bar. Kept
 * free of React and Tauri so they can be unit tested.
 */

/**
 * Working directory from a terminal title. Default bash and zsh prompts on
 * Debian, Ubuntu and Fedora set the title to "user@host: ~/dir" (some omit
 * the space). Returns null for any other title.
 */
export function cwdFromTitle(title: string): string | null {
  const match = /^[^\s@:]+@[^\s:]+:\s*((?:~|\/)\S*(?: \S+)*)\s*$/.exec(title.trim());
  return match ? match[1] : null;
}

/**
 * Working directory from an OSC 7 payload ("file://host/path"), as emitted by
 * shells with vte integration. Returns the decoded path or null.
 */
export function cwdFromOsc7(payload: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(payload.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Resolves a leading "~" against the remote home directory. */
export function expandHome(path: string, home: string | null): string | null {
  if (path === "~" || path.startsWith("~/")) {
    if (!home) return null;
    const base = home.endsWith("/") ? home.slice(0, -1) : home;
    return path === "~" ? base || "/" : `${base}${path.slice(1)}`;
  }
  return path.startsWith("/") ? path : null;
}

/**
 * Shortens the signed-in user's home directory to "~", as a shell prompt does.
 * Only /home/<user> and /root are recognised; anything else is left alone.
 */
export function abbreviateHome(path: string, username: string): string {
  const home = username === "root" ? "/root" : `/home/${username}`;
  if (!username || path === "") return path;
  if (path === home || path === `${home}/`) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** "Synced 2 min ago" style label for the title bar. */
export function syncedLabel(lastSyncMs: number | null, nowMs = Date.now()): string {
  if (lastSyncMs == null) return "Sync on";
  const seconds = Math.max(0, Math.floor((nowMs - lastSyncMs) / 1000));
  if (seconds < 60) return "Synced just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} h ago`;
  return `Synced ${Math.floor(hours / 24)} d ago`;
}

/** Two-letter initials for an avatar tile. */
export function initials(name: string): string {
  const words = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Window event a terminal fires when its shell reports a new working directory. */
export const TERMINAL_CWD_EVENT = "azalea-terminal-cwd";

export interface TerminalCwdDetail {
  sessionId: string;
  cwd: string;
}
