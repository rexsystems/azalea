import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("../src/lib/admin-users.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { planLimit, filterAdminUsers } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const settings = {
  plans: [
    { id: "free", name: "Free", limit_bytes: 1024 },
    { id: "team", name: "Development team", limit_bytes: 4096 },
  ],
};
const user = {
  id: "u",
  email: "u@example.com",
  role: "user",
  plan: "team",
  plan_name: "Development team",
  disabled: false,
  vault_limit_bytes: 4096,
  quota_override_bytes: null,
};

test("quota preview follows the selected plan rather than a stale saved limit", () => {
  assert.equal(planLimit(user, settings), 4096);
  assert.equal(planLimit({ ...user, plan: "free" }, settings), 1024);
  assert.equal(planLimit(user, null), 4096);
});

test("individual quotas survive plan changes and reset cleanly to the plan", () => {
  const custom = { ...user, plan: "free", quota_override_bytes: 8192 };
  assert.equal(planLimit(custom, settings), 8192);
  assert.equal(
    planLimit({ ...custom, quota_override_bytes: null }, settings),
    1024,
  );
});

test("users can be filtered by custom plan ID or display name", () => {
  assert.deepEqual(filterAdminUsers([user], "", "all", "team", "all"), [user]);
  assert.deepEqual(
    filterAdminUsers([user], "Development", "all", "all", "all"),
    [user],
  );
  assert.deepEqual(filterAdminUsers([user], "", "all", "free", "all"), []);
});
