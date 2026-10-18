import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/workspaces.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { captureWorkspace, parseWorkspaces, workspaceStorageKey } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("workspace round trip preserves duplicate hosts, local terminals, split pairs and active tab without credentials", () => {
  const snapshot = captureWorkspace([
    { id: "a", hostId: "server", splitWithId: "c", password: "secret" },
    { id: "b", hostId: "server" },
    { id: "c", hostId: "local", splitWithId: "a" },
    { id: "d", hostId: "other", poppedOut: true },
  ], "c", 0.6, (id) => id === "c");
  assert.deepEqual(snapshot, {
    tabs: [
      { hostId: "server", local: false, splitWith: 2 },
      { hostId: "server", local: false, splitWith: null },
      { hostId: "local", local: true, splitWith: 0 },
    ], activeTab: 2, splitRatio: 0.6,
  });
  const workspace = { ...snapshot, id: "test", name: "Production" };
  assert.deepEqual(parseWorkspaces(JSON.stringify([workspace])), [workspace]);
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
});

test("excluded popout splits are cleared and active tab falls back", () => {
  const snapshot = captureWorkspace([
    { id: "a", hostId: "host", splitWithId: "b" },
    { id: "b", hostId: "host", splitWithId: "a", poppedOut: true },
  ], "b", 0.5, () => false);
  assert.equal(snapshot.tabs[0].splitWith, null);
  assert.equal(snapshot.activeTab, 0);
});

test("invalid persisted references and malformed storage are rejected", () => {
  const valid = { id: "w", name: "Test", tabs: [{ hostId: "host", local: false, splitWith: null }], activeTab: 0, splitRatio: 0.5 };
  assert.deepEqual(parseWorkspaces(null), []);
  assert.throws(() => parseWorkspaces("{"));
  assert.throws(() => parseWorkspaces("{}"));
  assert.deepEqual(parseWorkspaces(JSON.stringify([
    null, { ...valid, activeTab: 2 }, { ...valid, splitRatio: 8 },
    { ...valid, tabs: [{ hostId: "host", local: false, splitWith: 0 }] },
    { ...valid, tabs: [{ hostId: "host", local: false, splitWith: 1 }, { hostId: "host", local: false, splitWith: null }] },
    valid,
  ])), [valid]);
});

test("workspace storage is isolated by account", () => {
  assert.notEqual(workspaceStorageKey("account-a"), workspaceStorageKey("account-b"));
});

test("workspace section renders empty, opening, storage errors and named controls", async () => {
  const output = await build({
    stdin: {
      contents: 'import { renderToStaticMarkup } from "react-dom/server"; import { WorkspacesSection } from "./src/components/WorkspacesSection"; export const render = (props) => renderToStaticMarkup(<WorkspacesSection {...props} />);',
      loader: "tsx", resolveDir: new URL("../", import.meta.url).pathname,
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" },
  });
  const { render } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
  const empty = render({ workspaces: [], canSave: false, busy: false });
  assert.ok(empty.includes("No saved workspaces"));
  assert.match(empty, /disabled=""/);
  const populated = render({ workspaces: [{ id: "w", name: "Production", tabs: [{}] }], canSave: true, busy: true, error: "Storage unavailable" });
  for (const text of ['role="status"', 'role="alert"', 'aria-label="Open Production"', 'aria-label="Rename Production"', 'aria-label="Delete Production"']) {
    assert.ok(populated.includes(text), text);
  }
});
