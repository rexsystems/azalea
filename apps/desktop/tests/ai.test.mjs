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
const web = await load("../src/lib/aiWeb.ts");
const selfhost = await load("../src/lib/selfhostUrl.ts");
const token = "azalea_test";
const start = `\x1b]9999;${token}:start\x07`;
const end = (code = 0) => `\x1b]9999;${token}:done:${code}\x07`;

test("self-host URLs support direct API, dashboard proxy and private IPv6", () => {
  assert.deepEqual(selfhost.resolveSelfHostUrls("https://sync.example.com"), { base_url: "https://sync.example.com/api", web_url: "https://sync.example.com" });
  assert.deepEqual(selfhost.resolveSelfHostUrls("http://127.0.0.1:9482"), { base_url: "http://127.0.0.1:9482", web_url: null });
  assert.deepEqual(selfhost.resolveSelfHostUrls("192.168.1.2:9843"), { base_url: "http://192.168.1.2:9843/api", web_url: "http://192.168.1.2:9843" });
  assert.deepEqual(selfhost.resolveSelfHostUrls("http://[fd00::1]:9843/api/"), { base_url: "http://[fd00::1]:9843/api", web_url: "http://[fd00::1]:9843" });
  for (const url of ["http://public.example.com", "https://user:secret@sync.example.com", "https://sync.example.com?token=secret", "https://sync.example.com#fragment", "ftp://sync.example.com", "http://[2001:4860:4860::8888]"]) assert.throws(() => selfhost.resolveSelfHostUrls(url));
});

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

test("search requests must be complete, bounded, and deduplicated", () => {
  assert.deepEqual(
    web.parseWebSearches(
      "```search\nTauri docs\n```\n```search\nTauri docs\n```",
    ),
    ["Tauri docs"],
  );
  assert.deepEqual(web.parseWebSearches("```search\nnot finished"), []);
  assert.deepEqual(
    web.parseWebSearches(`\`\`\`search\n${"x".repeat(601)}\n\`\`\``),
    [],
  );
  assert.equal(
    web.visibleAiText("Looking it up.\n```search\nprivate tool syntax"),
    "Looking it up.",
  );
  assert.match(web.visibleAiText("```bash\necho yes\n```"), /echo yes/);
});

test("the next AI turn waits for actual search results", async () => {
  let release;
  let streams = 0;
  const trace = [];
  const source = {
    title: "Official docs",
    url: "https://example.com/docs",
    snippet: "Verified excerpt",
  };
  const run = web.runWebSearchTurns(
    [{ role: "user", content: "Find documentation" }],
    {
      stream: async (messages) => {
        streams++;
        if (streams === 1)
          return "```search\nTauri docs\n```\n```bash\necho provisional\n```";
        assert.match(messages.at(-1).content, /https:\/\/example.com\/docs/);
        assert.match(messages.at(-1).content, /untrusted/);
        trace.push("response");
        return "Read [the docs](https://example.com/docs).";
      },
      search: async () => {
        trace.push("search");
        return new Promise((resolve) => {
          release = () => resolve([source]);
        });
      },
      enabled: () => true,
      stopped: () => false,
      readingSources: () => trace.push("results"),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(streams, 1);
  assert.deepEqual(trace, ["search"]);
  release();
  const final = await run;
  assert.deepEqual(trace, ["search", "results", "response"]);
  assert.doesNotMatch(final, /echo provisional/);
});

test("disabled searches never call a provider", async () => {
  let searched = false;
  await assert.rejects(
    web.runWebSearchTurns([], {
      stream: async () => "```search\nTauri docs\n```",
      search: async () => {
        searched = true;
        return [];
      },
      enabled: () => false,
      stopped: () => false,
      readingSources: () => {},
    }),
    /disabled/,
  );
  assert.equal(searched, false);
});

test("Stop during search prevents the follow-up AI request", async () => {
  let stopped = false;
  let streams = 0;
  const final = await web.runWebSearchTurns([], {
    stream: async () => {
      streams++;
      return "```search\nTauri docs\n```";
    },
    search: async () => {
      stopped = true;
      throw new Error("Stopped");
    },
    enabled: () => true,
    stopped: () => stopped,
    readingSources: () => assert.fail("Should not continue"),
  });
  assert.equal(streams, 1);
  assert.equal(final, "");
});

test("search failures are reported as failures, and retries are bounded", async () => {
  let streams = 0;
  let searches = 0;
  await assert.rejects(
    web.runWebSearchTurns([], {
      stream: async (messages) => {
        if (streams++ > 0)
          assert.match(
            messages.at(-1).content,
            /Search failed.*Do not invent sources/,
          );
        return "```search\nTauri docs\n```";
      },
      search: async () => {
        searches++;
        throw new Error("Quota exceeded");
      },
      enabled: () => true,
      stopped: () => false,
      readingSources: () => {},
    }),
    /three rounds/,
  );
  assert.equal(searches, 3);
});

test("Worked for excludes approval time and remains frozen when done", () => {
  const start = {
    userMessageId: "u",
    elapsedMs: 0,
    activeSince: 1000,
    status: "running",
    events: [],
  };
  const paused = web.transitionWork(start, "waiting", 4000);
  assert.equal(paused.elapsedMs, 3000);
  assert.equal(paused.activeSince, undefined);
  const resumed = web.transitionWork(paused, "running", 64000);
  const done = web.transitionWork(resumed, "done", 66000);
  assert.equal(done.elapsedMs, 5000);
  assert.equal(web.transitionWork(done, "done", 100000).elapsedMs, 5000);
  assert.equal(web.formatWorkDuration(196000), "3m 16s");
});

test("work history persists and interrupted runs recover as stopped", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const now = Date.now();
  ai.saveAiThread({
    id: "work-chat",
    sessionId: "local-test",
    title: "Find docs",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: "u",
        role: "user",
        content: "Find docs",
        createdAt: now,
        work: {
          userMessageId: "u",
          status: "running",
          elapsedMs: 1000,
          activeSince: now,
          events: [
            {
              id: "search",
              kind: "search",
              status: "done",
              label: "Search: Tauri docs",
              startedAt: now - 1000,
              finishedAt: now,
              sources: [
                {
                  title: "Docs",
                  url: "https://example.com",
                  snippet: "excerpt",
                },
              ],
            },
          ],
        },
      },
    ],
  });
  const recovered = ai.getAiThread("work-chat");
  assert.equal(recovered.messages[0].work.status, "stopped");
  assert.equal(recovered.messages[0].work.activeSince, undefined);
  assert.equal(
    recovered.messages[0].work.events[0].sources[0].url,
    "https://example.com",
  );
  assert.match(ai.exportAiThreadsJson([recovered]), /Search: Tauri docs/);
});

test("a completed agent run presents one final reply without losing intermediate messages", () => {
  const work = {
    userMessageId: "u",
    status: "done",
    elapsedMs: 1000,
    events: [],
  };
  const messages = [
    { id: "u", role: "user", content: "Fix it", work },
    {
      id: "plan",
      role: "assistant",
      content: "First inspect it.\n```bash\npwd\n```",
    },
    {
      id: "output",
      role: "user",
      internal: true,
      content: "Action results: /tmp",
    },
    { id: "next", role: "assistant", content: "Now check the files." },
    { id: "final", role: "assistant", content: "Done, verified." },
    { id: "next-user", role: "user", content: "Thanks" },
    { id: "legacy", role: "assistant", content: "You're welcome" },
  ];
  const snapshot = JSON.stringify(messages);
  const feed = web.projectAiConversation(messages);
  assert.deepEqual(
    feed.map((entry) =>
      entry.type === "run" ? entry.finalMessage?.id : entry.message.id,
    ),
    ["u", "final", "next-user", "legacy"],
  );
  assert.deepEqual(
    feed[1].messages.map((m) => m.id),
    ["plan", "next", "final"],
  );
  assert.equal(JSON.stringify(messages), snapshot);
});

test("running, waiting, stopped and failed runs keep all replies inside work history", () => {
  for (const status of ["running", "waiting", "stopped", "error"]) {
    const feed = web.projectAiConversation([
      {
        id: "u",
        role: "user",
        content: "Run it",
        work: { userMessageId: "u", status, elapsedMs: 0, events: [] },
      },
      { id: "a", role: "assistant", content: "```bash\necho pending\n```" },
    ]);
    assert.equal(feed.length, 2);
    assert.equal(feed[1].type, "run");
    assert.equal(feed[1].finalMessage, undefined);
    assert.equal(feed[1].messages[0].content.includes("echo pending"), true);
  }
});
