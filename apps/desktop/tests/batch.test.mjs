import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/batch.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { applyBatchEvent } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const queued = () => ({ status: "queued", output: [], exitCode: null, error: null });

const settingsBuild = await build({
  entryPoints: [new URL("../src/lib/batchSettings.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const batchSettings = await import(
  `data:text/javascript;base64,${Buffer.from(settingsBuild.outputFiles[0].text).toString("base64")}`
);

test("batch timeout defaults to one hour and disabled settings send no deadline", () => {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  let stored = null;
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (_, value) => {
      stored = value;
    },
  };
  globalThis.window = new EventTarget();
  try {
    assert.deepEqual(batchSettings.getStoredBatchSettings(), {
      timeoutEnabled: true,
      timeoutMinutes: 60,
    });
    assert.equal(batchSettings.batchTimeoutSeconds(batchSettings.getStoredBatchSettings()), 3600);
    let changes = 0;
    window.addEventListener(batchSettings.BATCH_SETTINGS_EVENT, () => {
      changes += 1;
    });
    batchSettings.setStoredBatchSettings({ timeoutEnabled: false, timeoutMinutes: 30 });
    assert.deepEqual(batchSettings.getStoredBatchSettings(), {
      timeoutEnabled: false,
      timeoutMinutes: 30,
    });
    assert.equal(batchSettings.batchTimeoutSeconds(batchSettings.getStoredBatchSettings()), null);
    assert.equal(changes, 1);
    batchSettings.setStoredBatchSettings({ timeoutEnabled: true, timeoutMinutes: 30 });
    assert.equal(batchSettings.batchTimeoutSeconds(batchSettings.getStoredBatchSettings()), 1800);
    assert.equal(batchSettings.batchTimeoutLabel(null), "No timeout");
    assert.equal(batchSettings.batchTimeoutLabel(3600), "1 hour per host");
    assert.equal(batchSettings.batchTimeoutLabel(7200), "2 hours per host");
    assert.equal(batchSettings.batchTimeoutLabel(1800), "30 minutes per host");
    for (const invalid of [0, -1, 0.5, Infinity, NaN, 10081]) {
      assert.throws(() =>
        batchSettings.setStoredBatchSettings({ timeoutEnabled: true, timeoutMinutes: invalid }),
      );
    }
    for (const raw of [
      "{",
      "null",
      "[]",
      '"text"',
      '{"timeoutEnabled":"false","timeoutMinutes":0}',
    ]) {
      stored = raw;
      assert.deepEqual(batchSettings.getStoredBatchSettings(), {
        timeoutEnabled: true,
        timeoutMinutes: 60,
      });
    }
    globalThis.localStorage.getItem = () => {
      throw new Error("Unavailable");
    };
    assert.deepEqual(batchSettings.getStoredBatchSettings(), batchSettings.defaultBatchSettings);
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.window = previousWindow;
  }
});

test("batch results isolate hosts and preserve stdout, stderr and failure output", () => {
  const initial = { a: queued(), b: queued() };
  let state = applyBatchEvent(initial, { kind: "started", host_id: "a" });
  state = applyBatchEvent(state, { kind: "output", host_id: "a", text: "one", stderr: false });
  state = applyBatchEvent(state, { kind: "output", host_id: "a", text: " two", stderr: false });
  state = applyBatchEvent(state, { kind: "output", host_id: "a", text: "denied", stderr: true });
  state = applyBatchEvent(state, {
    kind: "finished",
    host_id: "a",
    status: "failed",
    exit_code: 2,
    error: null,
  });
  assert.deepEqual(state.a.output, [
    { text: "one two", stderr: false },
    { text: "denied", stderr: true },
  ]);
  assert.equal(state.a.status, "failed");
  assert.equal(state.a.exitCode, 2);
  assert.equal(state.b, initial.b);
  assert.deepEqual(initial.a, queued());
  assert.equal(applyBatchEvent(state, { kind: "started", host_id: "a" }).a.status, "failed");
  assert.equal(
    applyBatchEvent(state, {
      kind: "output",
      host_id: "unselected",
      text: "ignored",
      stderr: false,
    }),
    state,
  );
});

test("timeout and cancellation retain partial output without implying a successful exit", () => {
  for (const status of ["timed_out", "cancelled"]) {
    let state = { a: queued() };
    state = applyBatchEvent(state, {
      kind: "output",
      host_id: "a",
      text: "partial",
      stderr: false,
    });
    state = applyBatchEvent(state, {
      kind: "finished",
      host_id: "a",
      status,
      exit_code: null,
      error: "interrupted",
    });
    assert.equal(state.a.output[0].text, "partial");
    assert.equal(state.a.exitCode, null);
    assert.equal(state.a.status, status);
  }
});
