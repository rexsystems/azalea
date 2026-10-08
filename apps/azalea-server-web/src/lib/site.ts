/** Canonical site URL for metadata. For self-host Docker this is often empty/IP. */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://127.0.0.1";
  return raw.replace(/\/$/, "");
}

export const SITE_NAME = "Azalea";

export const SITE_TAGLINE = "Self-hosted sync";

export const SITE_DESCRIPTION =
  "Sign in to your self-hosted Azalea sync server. Account, admin, and desktop authorize handoff.";

export const SITE_KEYWORDS = [
  "Azalea",
  "self-hosted",
  "SSH sync",
  "azalea-server",
];
