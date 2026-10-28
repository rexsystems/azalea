import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/terminalLinks.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { isTerminalLinkSafe, normalizeTerminalLink } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("terminal links allow https and mailto, block dangerous schemes", () => {
  assert.equal(isTerminalLinkSafe("https://example.com/path"), true);
  assert.equal(isTerminalLinkSafe("mailto:ops@example.com"), true);
  assert.equal(isTerminalLinkSafe("http://www.speedtest.net/privacy"), true);
  assert.equal(isTerminalLinkSafe("http://evil.example/"), false);
  assert.equal(isTerminalLinkSafe("file:///etc/passwd"), false);
  assert.equal(isTerminalLinkSafe("javascript:alert(1)"), false);
  assert.equal(isTerminalLinkSafe(""), false);
});

test("http://www. terminal links upgrade to https for the opener ACL", () => {
  assert.equal(
    normalizeTerminalLink("http://www.speedtest.net/privacy"),
    "https://www.speedtest.net/privacy",
  );
  assert.equal(
    normalizeTerminalLink("HTTPS://Example.COM/a"),
    "HTTPS://Example.COM/a",
  );
  assert.equal(normalizeTerminalLink("mailto:a@b.c"), "mailto:a@b.c");
});
