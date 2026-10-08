import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../out/", import.meta.url));
const target = new URL(process.env.AZALEA_SERVER_URL || "http://127.0.0.1:9482");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8" };
if (!existsSync(root)) throw new Error("Run npm run build before starting the dashboard.");
if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("AZALEA_SERVER_URL must be an HTTP(S) API URL without embedded credentials.");
const transport = target.protocol === "https:" ? await import("node:https") : http;
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (url.pathname.startsWith("/api/")) {
    const upstream = transport.request(new URL(`${target.pathname.replace(/\/$/, "")}${url.pathname.slice(4)}${url.search}`, target.origin), {
      method: request.method,
      headers: { ...request.headers, host: target.host },
    }, (reply) => {
      const cookies = reply.headers["set-cookie"];
      if (cookies) reply.headers["set-cookie"] = cookies.map((cookie) => cookie.replace(/Path=\/v1\/auth(?=;|$)/i, "Path=/api/v1/auth"));
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.setTimeout(190000, () => upstream.destroy(new Error("API request timed out")));
    upstream.on("error", () => { if (!response.headersSent) { response.writeHead(502, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: "upstream_error", message: "Cannot reach azalea-server. Check AZALEA_SERVER_URL." })); } else response.destroy(); });
    response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
    return;
  }
  if (url.pathname === "/") { response.writeHead(302, { Location: "/login" }); response.end(); return; }
  let requested;
  try { requested = path.resolve(root, `.${decodeURIComponent(url.pathname)}`); }
  catch { response.writeHead(400); response.end("Invalid path"); return; }
  if (!requested.startsWith(root) || requested.includes("\0")) { response.writeHead(403); response.end("Forbidden"); return; }
  const file = [requested, `${requested}.html`, path.join(requested, "index.html")].find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!file) { response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); const missing = path.join(root, "404.html"); if (existsSync(missing)) createReadStream(missing).pipe(response); else response.end("Not found"); return; }
  response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", url.pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache");
  if (request.method === "HEAD") { response.end(); return; }
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || "127.0.0.1", () => { const address = server.address(); const host = process.env.HOST || "127.0.0.1"; console.log(`Azalea server dashboard: http://${host.includes(":") ? `[${host}]` : host}:${address.port}`); });
