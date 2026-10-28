/**
 * Only allow safe URL schemes to escape the terminal into the user's browser.
 * A compromised remote shell can print arbitrary OSC 8 hyperlinks or naked
 * URLs; without this check it could inject `file:///Users/me/.ssh/id_ed25519`
 * or `javascript:...` links that would exfiltrate data the moment the user
 * clicks. `mailto:` is allowed because it's a common, low-risk external
 * launcher; bare `http://` is upgraded to `https://` when opening so the
 * opener ACL (`https://*` only) accepts www. shortcuts from shells.
 */
export function isTerminalLinkSafe(uri: string): boolean {
  if (typeof uri !== "string" || !uri) return false;
  const trimmed = uri.trim();
  if (trimmed.length > 4096) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("https://") ||
    lower.startsWith("mailto:") ||
    // Some shells emit `www.` shortcuts; xterm turns those into `http://www.`
    lower.startsWith("http://www.")
  );
}

/** Normalize a safe terminal link for the opener plugin (http://www → https). */
export function normalizeTerminalLink(uri: string): string {
  const trimmed = uri.trim();
  if (/^http:\/\/www\./i.test(trimmed)) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return trimmed;
}
