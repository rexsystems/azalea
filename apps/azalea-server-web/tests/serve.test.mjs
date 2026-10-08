import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";

test(
  "built dashboard serves routes and proxies sessions and streaming API output",
  { skip: !existsSync(new URL("../out/login.html", import.meta.url)) },
  async (t) => {
    const upstream = http.createServer((request, reply) => {
      assert.equal(request.url, "/v1/health");
      assert.equal(request.headers.authorization, "Bearer user-session");
      reply.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Set-Cookie": "azalea_refresh=value; HttpOnly; Path=/v1/auth",
      });
      reply.write("data: first\n\n");
      setTimeout(() => reply.end("data: [DONE]\n\n"), 30);
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const child = spawn(
      process.execPath,
      [new URL("../scripts/serve.mjs", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          AZALEA_SERVER_URL: `http://127.0.0.1:${upstream.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => child.kill());
    const url = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Preview exited with ${code}`)),
      );
    });
    assert.equal(
      (await fetch(url, { redirect: "manual" })).headers.get("location"),
      "/login",
    );
  for (const route of ["/login", "/admin/ai", "/admin/settings", "/admin/updates"]) {
      const result = await fetch(`${url}${route}`);
      assert.equal(result.status, 200);
      assert.match(result.headers.get("content-type"), /text\/html/);
    }
    const result = await fetch(`${url}/api/v1/health`, {
      headers: { Authorization: "Bearer user-session" },
    });
    assert.match(result.headers.get("set-cookie"), /Path=\/api\/v1\/auth/);
    assert.equal(await result.text(), "data: first\n\ndata: [DONE]\n\n");
    assert.equal((await fetch(`${url}/%2e%2e%2fpackage.json`)).status, 403);
  },
);
