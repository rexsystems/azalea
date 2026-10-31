/**
 * Compact "time since" label for a Unix timestamp in seconds, for dense lists
 * such as the workbench sidebar and file table: "now", "2 min", "3 h", "3 d",
 * "1 w", "1 mo", "2 y". Returns null when there is no timestamp so callers can
 * pick their own wording (the sidebar shows "never").
 */
export function formatSince(
  unixSeconds: number | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const diff = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  if (diff < 60) return "now";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  if (days < 30) return `${Math.floor(days / 7)} w`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${Math.floor(days / 365)} y`;
}

/** Spoken form of {@link formatSince} for accessible names and tooltips. */
export function describeSince(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  const short = formatSince(unixSeconds, nowMs);
  if (!short) return "Never connected";
  if (short === "now") return "Connected just now";
  const [count, unit] = short.split(" ");
  const words: Record<string, string> = {
    min: "minute",
    h: "hour",
    d: "day",
    w: "week",
    mo: "month",
    y: "year",
  };
  const word = words[unit] ?? unit;
  return `Connected ${count} ${word}${count === "1" ? "" : "s"} ago`;
}
