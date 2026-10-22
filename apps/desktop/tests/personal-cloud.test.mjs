import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const callback = source.slice(
  source.indexOf("  const handleConnectPersonalCloud ="),
  source.indexOf("  const handleConnectSelfhost ="),
);
const { code } = await transform(`export function create(ctx) {
  const { api, activeAccount, closeAllSessions, setActiveAccount, refreshAccounts,
    refreshHosts, refreshGroups, refreshKeys, refreshSyncStatus, setStatusMessage,
    openVaultDialog, setPendingCopyFromId } = ctx;
  const useCallback = (fn) => fn;
  ${callback}
  return handleConnectPersonalCloud;
}`, { loader: "ts", format: "esm" });
const { create } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function fixture(vaultExists, kind = "offline", copyFails = false) {
  const events = [];
  const ctx = {
    activeAccount: { id: "local", kind },
    api: {
      connectPersonalCloud: async () => ({
        account: { id: "drive", label: "Google Drive" }, vault_exists: vaultExists,
      }),
      copyAccountData: async (...args) => {
        events.push(["copy", ...args]);
        if (copyFails) throw new Error("Import failed");
      },
    },
  };
  for (const name of ["closeAllSessions", "setActiveAccount", "refreshAccounts",
    "refreshHosts", "refreshGroups", "refreshKeys", "refreshSyncStatus",
    "setStatusMessage", "openVaultDialog", "setPendingCopyFromId"]) {
    ctx[name] = (...args) => { events.push([name, ...args]); };
  }
  return { run: create(ctx), events };
}

test("empty personal cloud receives local data before display and vault setup", async () => {
  const { run, events } = fixture(false);
  await run("gdrive");
  assert.deepEqual(events.find(([name]) => name === "copy"), ["copy", "local", false]);
  const names = events.map(([name]) => name);
  assert.ok(names.indexOf("copy") < names.indexOf("refreshHosts"));
  assert.ok(names.indexOf("copy") < names.indexOf("openVaultDialog"));
  assert.ok(!names.includes("setPendingCopyFromId"));
});

test("existing or unknown vaults and other cloud profiles require a copy choice", async () => {
  for (const [exists, kind] of [[true, "offline"], [null, "offline"], [false, "selfhost"]]) {
    const { run, events } = fixture(exists, kind);
    await run("gdrive");
    assert.ok(!events.some(([name]) => name === "copy"));
    assert.deepEqual(events.find(([name]) => name === "setPendingCopyFromId"), ["setPendingCopyFromId", "local"]);
  }
});

test("copy failure refreshes the active profile and blocks empty vault setup", async () => {
  const { run, events } = fixture(false, "offline", true);
  await run("gdrive");
  assert.ok(events.some(([name]) => name === "refreshHosts"));
  assert.ok(!events.some(([name]) => name === "openVaultDialog"));
  assert.match(events.find(([name]) => name === "setStatusMessage")[1], /copying local data failed/);
  assert.ok(events.some(([name]) => name === "setPendingCopyFromId"));
});
