#!/usr/bin/env node
/**
 * Writes a Tauri v2 updater fragment for one platform.
 *
 * Usage:
 *   node .github/write-latest-json.mjs <version> <bundle-dir> <platform-key> [out-file]
 *
 * platform-key examples:
 *   windows-x86_64 | linux-x86_64 | darwin-aarch64 | darwin-x86_64
 *
 * Finds the signed updater artifact under <bundle-dir> and writes JSON with a
 * single platforms entry. The publish job merges all fragments into latest.json.
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

function pickArtifact() {
  const prefer = [
    /\.nsis\.zip$/i,
    /\.AppImage\.tar\.gz$/i,
    /\.app\.tar\.gz$/i,
  ];
  for (const re of prefer) {
    const hit = basenames.find((f) => re.test(f.name) && !f.name.endsWith(".sig"));
    if (hit) return hit;
  }

  // Fallback: any .sig sibling of an installer-like file
  const sig = basenames.find((f) => f.name.endsWith(".sig"));
  if (sig) {
    const base = sig.name.slice(0, -4);
    const sibling = basenames.find((f) => f.name === base);
    if (sibling) return sibling;
  }
  return null;
}

const artifact = pickArtifact();
if (!artifact) {
  console.error("No updater artifact found under", bundleDir);
  console.error(
    "Files present:",
    basenames.map((f) => f.name).sort().join(", ") || "(none)",
  );
  process.exit(1);
}

const sigPath = `${artifact.full}.sig`;
if (!existsSync(sigPath)) {
  console.error("Missing signature file:", sigPath);
  process.exit(1);
}

const signature = readFileSync(sigPath, "utf8").trim();
const baseUrl =
  process.env.UPDATER_DOWNLOAD_BASE_URL ??
  "https://github.com/rexsystems/azalea/releases/latest/download";
const url = `${baseUrl}/${artifact.name}`;

const fragment = {
  version,
  notes: `Azalea ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      url,
      signature,
    },
  },
};

const out = outFile ?? path.join(path.dirname(artifact.full), "latest-fragment.json");
writeFileSync(out, `${JSON.stringify(fragment, null, 2)}\n`);
console.log("Wrote", out, "→", platformKey, artifact.name);
