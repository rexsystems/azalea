/** Gravatar uses SHA-256 of the trimmed lowercased email (MD5 also still works). */
export async function emailSha256(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function gravatarUrl(
  email: string,
  size = 80,
  fallback: "identicon" | "mp" | "retro" | "404" = "identicon",
): Promise<string> {
  const hash = await emailSha256(email);
  const s = Math.max(1, Math.min(2048, Math.round(size)));
  return `https://www.gravatar.com/avatar/${hash}?s=${s}&d=${fallback}&r=g`;
}

export function emailInitials(email: string): string {
  const local = email.trim().split("@")[0] ?? "";
  const cleaned = local.replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase();
  if (cleaned.length === 1) return `${cleaned}${cleaned}`.toUpperCase();
  return "AZ";
}
