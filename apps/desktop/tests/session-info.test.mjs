import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/sessionInfo.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { cwdFromTitle, cwdFromOsc7, expandHome, syncedLabel, initials, abbreviateHome } =
  await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );

test("cwd comes from default user@host titles only", () => {
  assert.equal(cwdFromTitle("deploy@web-01: ~/app"), "~/app");
  assert.equal(cwdFromTitle("root@db:/var/log"), "/var/log");
  assert.equal(cwdFromTitle("pi@rpi-lab: ~"), "~");
  assert.equal(cwdFromTitle("vim notes.md"), null);
  assert.equal(cwdFromTitle("htop"), null);
});

test("OSC 7 payloads decode to a path", () => {
  assert.equal(cwdFromOsc7("file://web-01/home/deploy/my%20app"), "/home/deploy/my app");
  assert.equal(cwdFromOsc7("file:///tmp"), "/tmp");
  assert.equal(cwdFromOsc7("http://x/y"), null);
});

test("tilde expands against the remote home", () => {
  assert.equal(expandHome("~/app", "/home/deploy"), "/home/deploy/app");
  assert.equal(expandHome("~", "/home/deploy/"), "/home/deploy");
  assert.equal(expandHome("/srv", null), "/srv");
  assert.equal(expandHome("~/app", null), null);
  assert.equal(expandHome("relative", "/home/x"), null);
});

test("home directories shorten to a tilde", () => {
  assert.equal(abbreviateHome("/home/deploy/app", "deploy"), "~/app");
  assert.equal(abbreviateHome("/home/deploy", "deploy"), "~");
  assert.equal(abbreviateHome("/root/.ssh", "root"), "~/.ssh");
  assert.equal(abbreviateHome("/home/deployer/x", "deploy"), "/home/deployer/x");
  assert.equal(abbreviateHome("/srv/www", "deploy"), "/srv/www");
});

test("sync label counts minutes, hours and days", () => {
  const now = 1_800_000_000_000;
  assert.equal(syncedLabel(null, now), "Sync on");
  assert.equal(syncedLabel(now - 10_000, now), "Synced just now");
  assert.equal(syncedLabel(now - 120_000, now), "Synced 2 min ago");
  assert.equal(syncedLabel(now - 3 * 3_600_000, now), "Synced 3 h ago");
  assert.equal(syncedLabel(now - 2 * 86_400_000, now), "Synced 2 d ago");
});

test("initials use the first two words of a name or email", () => {
  assert.equal(initials("Alex Stefan"), "AS");
  assert.equal(initials("alex.stefan@example.com"), "AS");
  assert.equal(initials("Local"), "LO");
  assert.equal(initials(""), "?");
});
