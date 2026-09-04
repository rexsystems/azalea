#!/usr/bin/env node
/**
 * Merges Tauri updater fragments into a single latest.json.
 *
 * Usage:
 *   node .github/merge-latest-json.mjs <version> <search-dir> <out-file>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const version = process.argv[2];
const searchDir = process.argv[3];
const outFile = process.argv[4];

if (!version || !searchDir || !outFile) {
  console.error("Usage: node .github/merge-latest-json.mjs <version> <search-dir> <out-file>");
  process.exit(1);
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const fragments = walk(searchDir).filter(
  (f) => path.basename(f) === "latest-fragment.json" || path.basename(f) === "latest.json",
);

if (fragments.length === 0) {
  console.error("No updater fragments found under", searchDir);
  process.exit(1);
}

const platforms = {};
let notes = `Azalea ${version}`;
let pubDate = new Date().toISOString();

for (const file of fragments) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (data.notes) notes = data.notes;
  if (data.pub_date) pubDate = data.pub_date;
  Object.assign(platforms, data.platforms ?? {});
}

if (Object.keys(platforms).length === 0) {
  console.error("Merged platforms object is empty");
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms,
};

writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Merged", Object.keys(platforms).join(", "), "→", outFile);
