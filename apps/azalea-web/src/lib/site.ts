/** Canonical site URL for metadata, sitemap, and JSON-LD. */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://azalea.rexsystems.me";
  return raw.replace(/\/$/, "");
}

export const SITE_NAME = "Azalea";

export const SITE_TAGLINE = "Self-hosted sync dashboard";

export const SITE_DESCRIPTION =
  "Azalea self-hosted account and admin dashboard for your sync server.";

export const SITE_KEYWORDS = [
  "SSH client",
  "SSH terminal",
  "SSH for Windows",
  "SSH for Linux",
  "SSH for macOS",
  "open source SSH client",
  "SFTP client",
  "SSH key manager",
  "terminal emulator",
  "remote terminal",
  "port forwarding",
  "PuTTY alternative",
  "Termius alternative",
  "Azalea SSH",
];
