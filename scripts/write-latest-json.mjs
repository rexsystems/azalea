#!/usr/bin/env node
/**
 * Writes Tauri v2 updater latest.json next to NSIS artifacts.
 * Usage: node scripts/write-latest-json.mjs <version> <bundle-dir>
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const version = process.argv[2];
const bundleDir = process.argv[3];

if (!version || !bundleDir) {
  console.error("Usage: node scripts/write-latest-json.mjs <version> <bundle-dir>");
  process.exit(1);
}

const nsisDir = path.join(bundleDir, "nsis");
const files = readdirSync(nsisDir);

const zip = files.find((f) => f.endsWith(".nsis.zip"));
const setup =
  files.find((f) => f.endsWith("-setup.exe")) ??
  files.find((f) => f.endsWith(".exe") && !f.endsWith(".sig"));

const artifact = zip ?? setup;
if (!artifact) {
  console.error("No NSIS updater artifact found in", nsisDir);
  process.exit(1);
}

const sigFile = `${artifact}.sig`;
const signature = readFileSync(path.join(nsisDir, sigFile), "utf8").trim();
const baseUrl =
  process.env.UPDATER_DOWNLOAD_BASE_URL ??
  "https://github.com/rexsystems/azalea/releases/latest/download";
const url = `${baseUrl}/${artifact}`;

const manifest = {
  version,
  notes: `Azalea ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      url,
      signature,
    },
  },
};

const out = path.join(nsisDir, "latest.json");
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Wrote", out);
