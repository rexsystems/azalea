import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/appearance.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const appearance = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const { parseUiMode, parseUiTheme, resolveUiTheme, documentTheme, applyAppearance, setStoredUiMode } = appearance;

function installBrowserStubs(initial = {}) {
  const store = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.document = { documentElement: { dataset: {} } };
  const events = [];
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
    dispatchEvent: (event) => events.push(event.type),
  };
  globalThis.CustomEvent ??= class extends Event {};
  return { store, events, dataset: globalThis.document.documentElement.dataset };
}

test("every install defaults to the new interface, unknown values fall back to it", () => {
  assert.equal(parseUiMode(null), "new");
  assert.equal(parseUiMode("classic"), "new");
  assert.equal(parseUiMode("legacy"), "legacy");
  assert.equal(parseUiMode("minimal"), "minimal");
});

test("first ink or paper choice follows whether the legacy theme was light", () => {
  assert.equal(parseUiTheme(null, "noir"), "ink");
  assert.equal(parseUiTheme(null, "ember"), "ink");
  assert.equal(parseUiTheme(null, "white"), "paper");
  assert.equal(parseUiTheme(null, "pearl"), "paper");
  assert.equal(parseUiTheme("system", "white"), "system");
  assert.equal(parseUiTheme("bogus", "snow"), "paper");
});

test("system theme resolves from the OS color scheme", () => {
  assert.equal(resolveUiTheme("system", true), "ink");
  assert.equal(resolveUiTheme("system", false), "paper");
  assert.equal(resolveUiTheme("paper", true), "paper");
});

test("legacy mode shows the stored legacy theme, new modes show ink or paper", () => {
  assert.equal(documentTheme("legacy", "ember", "paper", true), "ember");
  assert.equal(documentTheme("new", "ember", "paper", true), "paper");
  assert.equal(documentTheme("minimal", "white", "system", true), "ink");
});

test("applyAppearance writes data-ui and data-theme from storage", () => {
  const { dataset } = installBrowserStubs({ "azalea-theme": "ember" });
  applyAppearance();
  assert.equal(dataset.ui, "new");
  assert.equal(dataset.theme, "ink");
});

test("switching back to legacy restores the old theme exactly", () => {
  const { dataset, store, events } = installBrowserStubs({ "azalea-theme": "pearl" });
  applyAppearance();
  assert.equal(dataset.theme, "paper");
  setStoredUiMode("legacy");
  assert.equal(store.get("azalea-ui-mode"), "legacy");
  assert.equal(dataset.ui, "legacy");
  assert.equal(dataset.theme, "pearl");
  assert.deepEqual(events, ["azalea-appearance"]);
});
