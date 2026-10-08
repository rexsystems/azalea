//! Helpers for self-hosted sync URLs (direct port, reverse proxy, Cloudflare tunnel).

/**
 * Resolve API + web URLs from a single server address.
 *
 * - `https://sync.example.com` → API `…/api`, web origin (tunnel / reverse proxy)
 * - `https://sync.example.com/api` → use that API path, web origin
 * - `http://127.0.0.1:9482` → API as-is (local / direct)
 *
 * Public (non-loopback) hosts MUST be `https://`. Plaintext HTTP to a public
 * host would send email + password credentials in the clear; we refuse rather
 * than allow it silently. Loopback / `.local` / RFC1918 / CGNAT addresses may
 * use `http://`.
 */
export function resolveSelfHostUrls(input: string): {
  base_url: string;
  web_url: string | null;
} {
  let raw = input.trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error("Enter your server URL.");
  }
  const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  if (explicitScheme && !/^https?:\/\//i.test(raw)) throw new Error("Use an http:// or https:// server URL.");
  if (!explicitScheme) {
    raw = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid server URL.");
  }

  if (url.username || url.password || url.search || url.hash) throw new Error("Server URLs must not contain credentials, query parameters or fragments.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^(?:fc|fd)[\da-f:]+$/i.test(host) ||
    host.endsWith(".local") ||
    isPrivateIpv4(host);
  if (!explicitScheme && isLocal) url.protocol = "http:";

  if (url.protocol === "http:" && !isLocal) {
    throw new Error(
      "Use https:// for a public server. http:// is only allowed for localhost / LAN addresses.",
    );
  }

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

  // Dashboard default port (:9843) proxies /api → sync server.
  if (url.port === "9843") {
    return {
      base_url: `${url.origin}/api`,
      web_url: url.origin,
    };
  }

  // Direct API port (no dashboard proxy).
  if (isLocal || url.port === "9482" || url.port === "8787") {
    return { base_url: url.origin, web_url: null };
  }

  return {
    base_url: `${url.origin}/api`,
    web_url: url.origin,
  };
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1, 5).map((s) => Number(s));
  if (o.some((n) => n < 0 || n > 255)) return false;
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT)
  return (
    o[0] === 10 ||
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127)
  );
}
