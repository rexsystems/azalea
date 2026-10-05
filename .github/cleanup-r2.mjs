#!/usr/bin/env node
/**
 * Delete stale Azalea installers from Cloudflare R2.
 * Keeps latest.json + every object referenced by it (+ matching .sig files).
 *
 * Env:
 *   R2_BUCKET, R2_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   DRY_RUN=1  — list deletes only
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bucket = process.env.R2_BUCKET || "azalea-updates";
const endpoint = process.env.R2_ENDPOINT;
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

if (!endpoint) {
  console.error("R2_ENDPOINT missing");
  process.exit(1);
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("AWS credentials missing");
  process.exit(1);
}

function aws(args, { json = false } = {}) {
  const out = execFileSync(
    "aws",
    [...args, "--endpoint-url", endpoint],
    {
      encoding: "utf8",
      env: { ...process.env, AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || "auto" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return json ? JSON.parse(out || "null") : out;
}

function listAllKeys() {
  const keys = [];
  let token;
  do {
    const args = [
      "s3api",
      "list-objects-v2",
      "--bucket",
      bucket,
      "--output",
      "json",
    ];
    if (token) args.push("--continuation-token", token);
    const page = aws(args, { json: true }) || {};
    for (const obj of page.Contents || []) {
      keys.push({ key: obj.Key, size: obj.Size || 0 });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return "";
  }
}

const tmpLatest = join(tmpdir(), `azalea-latest-${process.pid}.json`);
aws(["s3", "cp", `s3://${bucket}/latest.json`, tmpLatest]);
const latest = JSON.parse(readFileSync(tmpLatest, "utf8"));
unlinkSync(tmpLatest);

const keep = new Set(["latest.json"]);
for (const platform of Object.values(latest.platforms || {})) {
  const name = basenameFromUrl(platform?.url || "");
  if (!name) continue;
  keep.add(name);
  keep.add(`${name}.sig`);
}

// Current stamped version (e.g. 0.1.2+72) — keep any same-version artifacts (DMGs, etc.)
const version = String(latest.version || "");
const versionEncoded = version.replace(/\+/g, "%2B");

const objects = listAllKeys();
const totalBytes = objects.reduce((n, o) => n + o.size, 0);

const toDelete = [];
for (const { key, size } of objects) {
  if (keep.has(key)) continue;
  // Keep same-build siblings (dmg / extra bundles) for the live version only.
  if (version && (key.includes(version) || key.includes(versionEncoded))) {
    keep.add(key);
    continue;
  }
  toDelete.push({ key, size });
}

const keepBytes = objects
  .filter((o) => keep.has(o.key))
  .reduce((n, o) => n + o.size, 0);
const deleteBytes = toDelete.reduce((n, o) => n + o.size, 0);

function fmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

console.log(`Bucket s3://${bucket}`);
console.log(`Live version: ${version || "(unknown)"}`);
console.log(`Objects: ${objects.length} (${fmt(totalBytes)})`);
console.log(`Keep: ${keep.size} (${fmt(keepBytes)})`);
console.log(`Delete: ${toDelete.length} (${fmt(deleteBytes)})`);
console.log("Keeping:");
for (const k of [...keep].sort()) console.log(`  + ${k}`);

if (toDelete.length === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}

console.log(dryRun ? "Dry-run deletes:" : "Deleting:");
for (const { key, size } of toDelete.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`  - ${key} (${fmt(size)})`);
}

if (dryRun) {
  console.log("DRY_RUN=1 — no changes made.");
  process.exit(0);
}

// Batch delete (max 1000 per request).
for (let i = 0; i < toDelete.length; i += 1000) {
  const chunk = toDelete.slice(i, i + 1000);
  const payload = {
    Objects: chunk.map(({ key }) => ({ Key: key })),
    Quiet: true,
  };
  const payloadPath = join(tmpdir(), `azalea-r2-del-${process.pid}-${i}.json`);
  writeFileSync(payloadPath, JSON.stringify(payload));
  try {
    aws([
      "s3api",
      "delete-objects",
      "--bucket",
      bucket,
      "--delete",
      `file://${payloadPath}`,
    ]);
  } finally {
    try {
      unlinkSync(payloadPath);
    } catch {
      /* ignore */
    }
  }
}

console.log(`Deleted ${toDelete.length} objects (~${fmt(deleteBytes)}).`);
