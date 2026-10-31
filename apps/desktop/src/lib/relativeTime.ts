/**
 * Short "time since" label for a Unix timestamp in seconds, for dense lists
 * such as the workbench sidebar. Returns null when there is no timestamp so
 * callers can omit the label instead of showing a placeholder.
 */
export function formatSince(
  unixSeconds: number | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (unixSeconds == null || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const diff = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  if (diff < 60) return "just now";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
