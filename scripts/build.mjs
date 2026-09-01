#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = ["run", "tauri", "build", "--workspace", "@azalea/desktop"];
const extraArgs = process.argv.slice(2);

// If no signing key is configured and user didn't specify --no-sign, default to --no-sign so local builds succeed seamlessly
const hasSignFlag = extraArgs.includes("--no-sign");
const hasKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);

const passthrough = [];
if (!hasKey && !hasSignFlag) {
  passthrough.push("--no-sign");
}
passthrough.push(...extraArgs);

if (passthrough.length > 0) {
  args.push("--", ...passthrough);
}

const result = spawnSync("npm", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 0);
