import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/relativeTime.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { formatSince, describeSince } = await import(
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
  assert.equal(formatSince(ago(5), now), "now");
  assert.equal(formatSince(ago(60), now), "1 min");
  assert.equal(formatSince(ago(59 * 60), now), "59 min");
  assert.equal(formatSince(ago(3 * 3600), now), "3 h");
  assert.equal(formatSince(ago(2 * 86400), now), "2 d");
  assert.equal(formatSince(ago(14 * 86400), now), "2 w");
  assert.equal(formatSince(ago(90 * 86400), now), "3 mo");
  assert.equal(formatSince(ago(800 * 86400), now), "2 y");
});

test("timestamps in the future clamp to now", () => {
  assert.equal(formatSince(ago(-120), now), "now");
});

test("spoken labels spell out the unit", () => {
  assert.equal(describeSince(null, now), "Never connected");
  assert.equal(describeSince(ago(5), now), "Connected just now");
  assert.equal(describeSince(ago(86400), now), "Connected 1 day ago");
  assert.equal(describeSince(ago(21 * 86400), now), "Connected 3 weeks ago");
});
