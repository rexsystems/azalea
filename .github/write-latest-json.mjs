#!/usr/bin/env node
/**
 * Writes a Tauri v2 updater fragment for one OS family.
 *
 * Usage:
 *   node .github/write-latest-json.mjs <version> <bundle-dir> <platform-key> [out-file]
 *
 * platform-key examples:
 *   windows-x86_64 | linux-x86_64 | darwin-aarch64 | darwin-x86_64
 *
 * For linux-x86_64, emits every signed updater artifact found:
 *   AppImage (.tar.gz or raw) → linux-x86_64
 *   .rpm → linux-x86_64-rpm
 *   .deb → linux-x86_64-deb
 *
 * Finds signed updater artifacts under <bundle-dir> and writes JSON.
 * The publish job merges all fragments into latest.json.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const version = process.argv[2];
const bundleDir = process.argv[3];
const platformKey = process.argv[4];
const outFile = process.argv[5];

if (!version || !bundleDir || !platformKey) {
  console.error(
    "Usage: node .github/write-latest-json.mjs <version> <bundle-dir> <platform-key> [out-file]",
  );
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

const allFiles = walk(bundleDir);
const basenames = allFiles.map((f) => ({ full: f, name: path.basename(f) }));

function findSigned(predicate) {
  const hit = basenames.find(
    (f) => predicate(f.name) && !f.name.endsWith(".sig") && existsSync(`${f.full}.sig`),
  );
  return hit ?? null;
}

/**
 * @returns {{ key: string, artifact: { full: string, name: string } }[]}
 */
function pickArtifacts() {
  const found = [];

  if (platformKey.startsWith("linux-")) {
    const appImage =
      findSigned((n) => /\.AppImage\.tar\.gz$/i.test(n)) ??
      findSigned((n) => /\.AppImage$/i.test(n));
    if (appImage) found.push({ key: platformKey, artifact: appImage });

    const rpm = findSigned((n) => /\.rpm$/i.test(n));
    if (rpm) found.push({ key: `${platformKey}-rpm`, artifact: rpm });

    const deb = findSigned((n) => /\.deb$/i.test(n));
    if (deb) found.push({ key: `${platformKey}-deb`, artifact: deb });

    return found;
  }

  if (platformKey.startsWith("windows-")) {
    const nsis =
      findSigned((n) => /\.nsis\.zip$/i.test(n)) ??
      findSigned((n) => /-setup\.exe$/i.test(n));
    if (nsis) {
      found.push({ key: platformKey, artifact: nsis });
      return found;
    }
    const msi = findSigned((n) => /\.msi$/i.test(n));
    if (msi) found.push({ key: platformKey, artifact: msi });
    return found;
  }

  // macOS / generic: prefer .app.tar.gz
  const app =
    findSigned((n) => /\.app\.tar\.gz$/i.test(n)) ??
    findSigned((n) => /\.tar\.gz$/i.test(n));
  if (app) found.push({ key: platformKey, artifact: app });
  return found;
}

const picked = pickArtifacts();
if (picked.length === 0) {
  console.error("No signed updater artifact found under", bundleDir);
  console.error(
    "Files present:",
    basenames.map((f) => f.name).sort().join(", ") || "(none)",
  );
  process.exit(1);
}

const baseUrl =
  process.env.UPDATER_DOWNLOAD_BASE_URL ??
  "https://github.com/rexsystems/azalea/releases/latest/download";

const platforms = {};
for (const { key, artifact } of picked) {
  const signature = readFileSync(`${artifact.full}.sig`, "utf8").trim();
  platforms[key] = {
    url: `${baseUrl}/${artifact.name}`,
    signature,
  };
  console.log("  ", key, "←", artifact.name);
}

const fragment = {
  version,
  notes: `Azalea ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

const out = outFile ?? path.join(bundleDir, "latest-fragment.json");
writeFileSync(out, `${JSON.stringify(fragment, null, 2)}\n`);
console.log("Wrote", out, "→", Object.keys(platforms).join(", "));
