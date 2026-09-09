//! Helpers for self-hosted sync URLs (direct port, reverse proxy, Cloudflare tunnel).

/**
 * Resolve API + web URLs from a single server address.
 *
 * - `https://sync.example.com` → API `…/api`, web origin (tunnel / reverse proxy)
 * - `https://sync.example.com/api` → use that API path, web origin
 * - `http://127.0.0.1:9482` → API as-is (local / direct)
 */
export function resolveSelfHostUrls(input: string): {
  base_url: string;
  web_url: string | null;
} {
  let raw = input.trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error("Enter your server URL.");
  }
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid server URL.");
  }

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  const path = url.pathname.replace(/\/+$/, "") || "";

  if (path === "/api" || path.endsWith("/api")) {
    return {
      base_url: `${url.origin}${path}`,
      web_url: url.origin,
    };
  }

  if (path && path !== "/") {
    return {
      base_url: `${url.origin}${path}`,
      web_url: url.origin,
    };
  }

  if (isLocal || url.port === "9482" || url.port === "8787") {
    return { base_url: url.origin, web_url: null };
  }

  return {
    base_url: `${url.origin}/api`,
    web_url: url.origin,
  };
}
