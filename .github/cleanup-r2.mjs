#!/usr/bin/env node
/**
 * Prune / organize Azalea installers on Cloudflare R2.
 *
 * Layout:
 *   latest.json                      ← bucket root (updater entrypoint)
 *   builds/v0.1.2-build.72/<file>    ← one folder per release
 *
 * Keeps latest.json + the live build folder. Optionally migrates leftover
 * flat root artifacts into that folder and rewrites latest.json URLs.
 *
 * Env:
 *   R2_BUCKET, R2_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   DRY_RUN=1     — list only
 *   MIGRATE=0     — skip flat→folder migration (default: migrate when needed)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactPublicUrl,
  buildPrefixFromVersion,
  encodeArtifactPath,
} from "./r2-layout.mjs";

const bucket = process.env.R2_BUCKET || "azalea-updates";
const endpoint = process.env.R2_ENDPOINT;
const baseUrl =
  process.env.UPDATER_DOWNLOAD_BASE_URL ||
  "https://updates.azalea.rexsystems.me";
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const migrate =
  process.env.MIGRATE !== "0" && process.env.MIGRATE !== "false";

if (!endpoint) {
  console.error("R2_ENDPOINT missing");
  process.exit(1);
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("AWS credentials missing");
  process.exit(1);
}

function aws(args, { json = false } = {}) {
  const out = execFileSync("aws", [...args, "--endpoint-url", endpoint], {
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION || "auto",
    },
    maxBuffer: 64 * 1024 * 1024,
  });
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

function keyFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

function fmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

function copyObject(fromKey, toKey) {
  // R2 rejects GetObjectTagging used by `aws s3 cp` server-side copies.
  // Keep `+` literal in the key — encoding it as %2B makes R2 look up the wrong object.
  aws([
    "s3api",
    "copy-object",
    "--bucket",
    bucket,
    "--copy-source",
    `${bucket}/${fromKey}`,
    "--key",
    toKey,
  ]);
}

function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const payload = {
      Objects: chunk.map((key) => ({ Key: key })),
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
}

const tmpLatest = join(tmpdir(), `azalea-latest-${process.pid}.json`);
aws(["s3", "cp", `s3://${bucket}/latest.json`, tmpLatest]);
let latest = JSON.parse(readFileSync(tmpLatest, "utf8"));
unlinkSync(tmpLatest);

const version = String(latest.version || "");
const livePrefix = buildPrefixFromVersion(version);
const livePrefixSlash = `${livePrefix}/`;

console.log(`Bucket s3://${bucket}`);
console.log(`Live version: ${version || "(unknown)"}`);
console.log(`Live folder: ${livePrefix}/`);

let objects = listAllKeys();
const keySet = new Set(objects.map((o) => o.key));

// --- migrate flat root installers into builds/<tag>/ when needed ---
const platformKeys = Object.values(latest.platforms || {})
  .map((p) => keyFromUrl(p?.url || ""))
  .filter(Boolean);
const needsMigrate =
  migrate &&
  platformKeys.some((k) => k && !k.startsWith("builds/"));

if (needsMigrate) {
  console.log("Migrating flat artifacts into", livePrefixSlash);
  const rewritten = { ...latest, platforms: { ...latest.platforms } };
  const moved = [];

  for (const [plat, info] of Object.entries(latest.platforms || {})) {
    const oldKey = keyFromUrl(info?.url || "");
    if (!oldKey) continue;
    const fileName = oldKey.split("/").pop();
    const newKey = `${livePrefix}/${fileName}`;
    if (oldKey !== newKey && keySet.has(oldKey)) {
      if (!dryRun) {
        copyObject(oldKey, newKey);
      }
      moved.push(`${oldKey} → ${newKey}`);
      const sigOld = `${oldKey}.sig`;
      const sigNew = `${newKey}.sig`;
      if (keySet.has(sigOld)) {
        if (!dryRun) {
          copyObject(sigOld, sigNew);
        }
        moved.push(`${sigOld} → ${sigNew}`);
      }
    } else if (!keySet.has(oldKey) && keySet.has(newKey)) {
      // already moved
    } else if (keySet.has(oldKey) && oldKey.startsWith("builds/")) {
      // already foldered
    }

    rewritten.platforms[plat] = {
      ...info,
      url: artifactPublicUrl(baseUrl, newKey),
    };
  }

  // Also scoop same-version root siblings (dmg/msi) into the live folder.
  const versionNeedle = version;
  const versionEncoded = version.replace(/\+/g, "%2B");
  for (const { key } of objects) {
    if (key.includes("/")) continue; // already nested or latest.json
    if (key === "latest.json") continue;
    if (!(key.includes(versionNeedle) || key.includes(versionEncoded))) continue;
    const newKey = `${livePrefix}/${key}`;
    if (keySet.has(newKey)) continue;
    if (!dryRun) {
      copyObject(key, newKey);
    }
    moved.push(`${key} → ${newKey}`);
  }

  for (const line of moved) console.log("  ", line);

  if (!dryRun) {
    const outPath = join(tmpdir(), `azalea-latest-rewritten-${process.pid}.json`);
    writeFileSync(outPath, `${JSON.stringify(rewritten, null, 2)}\n`);
    aws([
      "s3",
      "cp",
      outPath,
      `s3://${bucket}/latest.json`,
      "--content-type",
      "application/json",
      "--cache-control",
      "public, max-age=60",
    ]);
    unlinkSync(outPath);
    latest = rewritten;
  } else {
    latest = rewritten;
    console.log("DRY_RUN=1 — skipped copy / latest.json rewrite");
  }

  objects = dryRun ? objects : listAllKeys();
}

// --- prune anything outside latest.json + live build folder ---
const keep = new Set(["latest.json"]);
for (const platform of Object.values(latest.platforms || {})) {
  const key = keyFromUrl(platform?.url || "");
  if (!key) continue;
  keep.add(key);
  keep.add(`${key}.sig`);
}

const toDelete = [];
for (const { key, size } of objects) {
  if (key === "latest.json") continue;
  if (key.startsWith(livePrefixSlash)) {
    keep.add(key);
    continue;
  }
  if (keep.has(key)) continue;
  toDelete.push({ key, size });
}

const totalBytes = objects.reduce((n, o) => n + o.size, 0);
const keepBytes = objects
  .filter((o) => keep.has(o.key) || o.key.startsWith(livePrefixSlash) || o.key === "latest.json")
  .reduce((n, o) => n + o.size, 0);
const deleteBytes = toDelete.reduce((n, o) => n + o.size, 0);

console.log(`Objects: ${objects.length} (${fmt(totalBytes)})`);
console.log(`Keep: ~${fmt(keepBytes)}`);
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
  console.log("DRY_RUN=1 — no deletes performed.");
  process.exit(0);
}

deleteKeys(toDelete.map((o) => o.key));
console.log(`Deleted ${toDelete.length} objects (~${fmt(deleteBytes)}).`);
console.log(`Live manifest: ${baseUrl}/latest.json`);
console.log(`Live artifacts: ${baseUrl}/${encodeArtifactPath(livePrefix)}/`);
