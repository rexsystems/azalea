import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function client() {
  const values = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const source = await readFile(
    new URL("../src/lib/azalea-api.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(`${code}\n// ${crypto.randomUUID()}`).toString("base64")}`
  );
}

function session(expires, id = "old") {
  return {
    access_token: `${id}.${Buffer.from(JSON.stringify({ exp: expires })).toString("base64url")}.signature`,
    expires_in: 600,
    user: { id: "user", email: "user@example.com", role: "admin" },
  };
}

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("simultaneous expired admin requests rotate the cookie once and retry with the new token", async () => {
  const api = await client();
  const old = session(1);
  const fresh = session(Math.floor(Date.now() / 1000) + 600, "fresh");
  api.storeSession(old);
  let refreshes = 0;
  let retries = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, "include");
    if (url.endsWith("/auth/refresh")) {
      refreshes++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response(fresh);
    }
    if (options.headers.get("Authorization") === `Bearer ${old.access_token}`)
      return response({ error: "unauthorized" }, 401);
    assert.equal(
      options.headers.get("Authorization"),
      `Bearer ${fresh.access_token}`,
    );
    retries++;
    return response({ ok: true });
  };
  assert.deepEqual(
    await Promise.all([
      api.apiRequest("/v1/admin/settings"),
      api.apiRequest("/v1/admin/ai"),
    ]),
    [{ ok: true }, { ok: true }],
  );
  assert.equal(refreshes, 1);
  assert.equal(retries, 2);
});

test("network errors preserve the session and rejected expired refreshes clear it", async () => {
  const api = await client();
  api.storeSession(session(1));
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await api.refreshSession(), null);
  assert.ok(api.getStoredSession());
  globalThis.fetch = async () => response({ error: "unauthorized" }, 401);
  assert.equal(await api.refreshSession(), null);
  assert.equal(api.getStoredSession(), null);
});

test("public auth calls do not send access tokens or recursively refresh", async () => {
  const api = await client();
  api.storeSession(session(1));
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers.get("Authorization"), null);
    return response({ message: "Invalid credentials" }, 401);
  };
  await assert.rejects(
    api.login("user@example.com", "wrong"),
    (error) => error.status === 401 && error.message === "Invalid credentials",
  );
  assert.equal(calls, 1);
});
