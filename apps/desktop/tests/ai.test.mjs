import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { build } from "esbuild";

async function load(entry, plugins = []) {
  const result = await build({
    entryPoints: [new URL(entry, import.meta.url).pathname],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');",
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const command = await load("../src/lib/aiCommand.ts", [
  {
    name: "terminal-mock",
    setup(build) {
      build.onResolve(
        { filter: /^\.\/api$|^@tauri-apps\/api\/event$/ },
        ({ path }) => ({ path, namespace: "mock" }),
      );
      build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
        contents:
          path === "./api"
            ? "export const writeTerminal = (...args) => globalThis.terminalMock.write(...args);"
            : "export const listen = (...args) => globalThis.terminalMock.listen(...args);",
      }));
    },
  },
]);
const ai = await load("../src/lib/ai.ts");
const token = "azalea_test";
const start = `\x1b]9999;${token}:start\x07`;
const end = (code = 0) => `\x1b]9999;${token}:done:${code}\x07`;

test("completion markers work across every possible event boundary", () => {
  const input = `old output${start}hello\r\n${end(17)}prompt`;
  for (let boundary = 0; boundary < input.length; boundary++) {
    const tracker = new command.CommandOutputTracker(token);
    const first = tracker.push(input.slice(0, boundary));
    const result = first ?? tracker.push(input.slice(boundary));
    assert.deepEqual(result, { output: "hello\r\n", exitCode: 17 });
  }
});

test("quiet output, echoed wrappers and other command tokens cannot finish a command", () => {
  const tracker = new command.CommandOutputTracker(token);
  assert.equal(tracker.push(command.trackedCommand("true", token)), null);
  assert.equal(tracker.push(`${start}still running\n`), null);
  assert.equal(tracker.push("\x1b]9999;azalea_other:done:0\x07"), null);
  assert.equal(tracker.push(end()).exitCode, 0);
});

test("large output stays bounded without losing completion", () => {
  const tracker = new command.CommandOutputTracker(token);
  tracker.push(start + "x".repeat(100000));
  assert.ok(tracker.snapshot().length <= 64000);
  assert.equal(tracker.push("tail" + end()).output.endsWith("tail"), true);
});

test("real shell waits through silence and returns exit status", async () => {
  const tracker = new command.CommandOutputTracker(token);
  const child = spawn("bash", ["--noprofile", "--norc"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let result;
  let sawFirst = false;
  const began = Date.now();
  child.stdout.on("data", (chunk) => {
    result = tracker.push(chunk.toString()) ?? result;
    if (!sawFirst && tracker.snapshot().includes("first")) {
      sawFirst = true;
      assert.equal(result, undefined);
    }
  });
  child.stderr.on("data", (chunk) => tracker.push(chunk.toString()));
  child.stdin.end(
    command.trackedCommand(
      "printf 'first\\n'; sleep 1.2; printf 'last\\n'; sh -c 'exit 7'",
      token,
    ),
  );
  await new Promise((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  assert.ok(sawFirst);
  assert.ok(Date.now() - began >= 1100);
  assert.equal(result.exitCode, 7);
  assert.equal(result.output, "first\nlast\n");
});

test("shell quoting preserves multiline scripts and cwd", async () => {
  const child = spawn("bash", ["--noprofile", "--norc"]);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stdin.end(
    command.trackedCommand(
      "cd /tmp\nprintf '%s\\n' 'a quoted value'\ncat <<'EOF'\n# literal comment\n\nend\nEOF",
      token,
    ) + "pwd\n",
  );
  await new Promise((resolve) => child.on("close", resolve));
  assert.match(output, /a quoted value\n# literal comment\n\nend/);
  assert.ok(output.endsWith("/tmp\n"));
});

function terminalHarness({ failWrite = false, delayListen = false } = {}) {
  const listeners = new Map();
  const writes = [];
  globalThis.terminalMock = {
    async listen(name, fn) {
      if (delayListen) await new Promise((r) => setTimeout(r, 10));
      listeners.set(name, fn);
      return () => listeners.delete(name);
    },
    async write(id, data) {
      if (failWrite) throw new Error("write failed");
      writes.push([id, atob(data)]);
    },
  };
  return {
    listeners,
    writes,
    emit(name, payload) {
      listeners.get(name)?.({ payload });
    },
    async ready() {
      while (!writes.length && !failWrite)
        await new Promise((r) => setTimeout(r, 1));
    },
  };
}

test("command execution filters sessions and removes listeners on completion", async () => {
  const h = terminalHarness();
  const controller = new AbortController();
  const run = command.runAiCommand(
    "session1",
    "true",
    controller.signal,
    () => {},
  );
  await h.ready();
  const id = /'([^']+)'; eval/.exec(h.writes[0][1])[1];
  h.emit("terminal-status", { session_id: "other", status: "exited" });
  const data = btoa(`\x1b]9999;${id}:start\x07ok\x1b]9999;${id}:done:0\x07`);
  h.emit("terminal-output", { session_id: "other", data });
  await assert.rejects(
    command.runAiCommand("session1", "true", controller.signal, () => {}),
    /already running/,
  );
  h.emit("terminal-output", { session_id: "session1", data });
  assert.deepEqual(await run, { output: "ok", exitCode: 0 });
  assert.equal(h.listeners.size, 0);
});

test("Stop interrupts the terminal and cleans listeners", async () => {
  const h = terminalHarness();
  const controller = new AbortController();
  const run = command.runAiCommand(
    "session1",
    "sleep 30",
    controller.signal,
    () => {},
  );
  await h.ready();
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(h.writes.at(-1)[1], "\x03");
  assert.equal(h.listeners.size, 0);
});

test("abort during listener setup never dispatches a command or leaks listeners", async () => {
  const h = terminalHarness({ delayListen: true });
  const controller = new AbortController();
  const run = command.runAiCommand(
    "session1",
    "true",
    controller.signal,
    () => {},
  );
  controller.abort();
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(h.writes.length, 0);
  assert.equal(h.listeners.size, 0);
});

test("write failure and disconnection stop execution", async () => {
  const h = terminalHarness({ failWrite: true });
  await assert.rejects(
    command.runAiCommand(
      "session1",
      "true",
      new AbortController().signal,
      () => {},
    ),
    /write failed/,
  );
  assert.equal(h.listeners.size, 0);
  const next = terminalHarness();
  const run = command.runAiCommand(
    "session1",
    "true",
    new AbortController().signal,
    () => {},
  );
  await next.ready();
  next.emit("terminal-status", {
    session_id: "session1",
    status: "disconnected",
  });
  await assert.rejects(run, /disconnected/);
  assert.equal(next.listeners.size, 0);
});

test("action parsing preserves heredoc contents, comments and blank lines", () => {
  const script = "cat <<'EOF'\n# literal\n\nend\nEOF";
  assert.equal(
    ai.parseSuggestedActions(`\`\`\`bash\n${script}\n\`\`\``)[0].command,
    script,
  );
  assert.deepEqual(
    ai.parseSuggestedActions("```bash\n# only a comment\n```"),
    [],
  );
  assert.deepEqual(ai.parseSuggestedActions("```bash\necho unfinished"), []);
});

test("custom model IDs persist per provider and empty values stay empty", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  globalThis.window = new EventTarget();
  ai.setAiPrefs({ providerId: "custom_openai" });
  ai.setAiPrefs({ customBaseUrl: "https://one.example/v1", model: "first" });
  ai.addCustomAiModels("custom_openai", "alpha,beta\nalpha\ngamma");
  assert.deepEqual(ai.getAiPrefs().customModels.custom_openai, [
    "alpha",
    "beta",
    "gamma",
  ]);
  assert.equal(ai.getAiPrefs().model, "alpha");
  ai.setAiPrefs({ providerId: "ollama" });
  assert.equal(ai.getAiPrefs().customBaseUrl, "");
  assert.equal(ai.getAiPrefs().model, "");
  ai.setAiPrefs({ providerId: "custom_openai" });
  assert.equal(ai.getAiPrefs().model, "alpha");
  assert.equal(ai.getAiPrefs().customBaseUrl, "https://one.example/v1");
  ai.setAiPrefs({ model: "" });
  assert.equal(ai.getAiPrefs().model, "");
});

test("Markdown renders headings, tables, lists, safe links, and write approval", async () => {
  const { html } = await load("./markdown-fixture.tsx");
  const rendered = html();
  assert.match(rendered, /<h3[^>]*>Heading<\/h3>/);
  assert.match(rendered, /<ul/);
  assert.match(rendered, /<table/);
  assert.match(rendered, /<strong/);
  assert.match(rendered, /write \/tmp\/test.conf/);
  assert.match(rendered, />Approve<\/button>/);
  assert.doesNotMatch(rendered, /href="javascript:|<script>/);
});
