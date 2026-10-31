import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../src/lib/commandRisk.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { isReadOnlyCommand } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("inspection commands are read only", () => {
  for (const cmd of [
    "sudo journalctl -u php8.3-fpm -n 30 --no-pager",
    "systemctl status nginx",
    "df -h && free -m",
    "ps aux | grep nginx",
    "docker logs web 2>&1 | tail -n 50",
    "sudo -u deploy ls -la /srv",
    "nginx -t",
    "find /var/log -name '*.gz'",
  ]) {
    assert.equal(isReadOnlyCommand(cmd), true, cmd);
  }
});

test("writes, unknown commands and substitutions are not read only", () => {
  for (const cmd of [
    "sudo systemctl restart nginx",
    "rm -rf /tmp/cache",
    "echo hi > /etc/motd",
    "cat file | tee out.txt",
    "ls $(rm -rf /)",
    "find /tmp -name x -delete",
    "journalctl --vacuum-time=2d",
    "git push",
    "docker rm web",
    "make deploy",
    "",
  ]) {
    assert.equal(isReadOnlyCommand(cmd), false, cmd);
  }
});
