import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/relativeTime.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { formatSince } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const now = Date.UTC(2026, 9, 31, 12, 0, 0);
const ago = (seconds) => Math.floor(now / 1000) - seconds;

test("missing or invalid timestamps produce no label", () => {
  assert.equal(formatSince(null, now), null);
  assert.equal(formatSince(undefined, now), null);
  assert.equal(formatSince(0, now), null);
  assert.equal(formatSince(Number.NaN, now), null);
});

test("labels step through minutes, hours, days, weeks, months and years", () => {
  assert.equal(formatSince(ago(5), now), "just now");
  assert.equal(formatSince(ago(60), now), "1m ago");
  assert.equal(formatSince(ago(59 * 60), now), "59m ago");
  assert.equal(formatSince(ago(3 * 3600), now), "3h ago");
  assert.equal(formatSince(ago(2 * 86400), now), "2d ago");
  assert.equal(formatSince(ago(14 * 86400), now), "2w ago");
  assert.equal(formatSince(ago(90 * 86400), now), "3mo ago");
  assert.equal(formatSince(ago(800 * 86400), now), "2y ago");
});

test("timestamps in the future clamp to just now", () => {
  assert.equal(formatSince(ago(-120), now), "just now");
});
