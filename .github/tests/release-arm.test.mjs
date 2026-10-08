import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("signed Linux ARM64 and x64 artifacts retain separate updater entries after merging", async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), "azalea-arm-release-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [arch, debArch] of [["x86_64", "amd64"], ["aarch64", "arm64"]]) {
    const bundle = path.join(folder, arch);
    await mkdir(bundle);
    const files = [`Azalea_0.2.0+1_${arch}.AppImage`, `Azalea_0.2.0+1_${debArch}.deb`, `Azalea-0.2.0+1.${arch}.rpm`];
    for (const file of files) {
      await writeFile(path.join(bundle, file), "test release payload");
      await writeFile(path.join(bundle, `${file}.sig`), `test-signature-${arch}`);
    }
    execFileSync(process.execPath, [path.join(root, ".github/write-latest-json.mjs"), "0.2.0+1", bundle, `linux-${arch}`, path.join(bundle, "latest-fragment.json")], { stdio: "pipe", env: { ...process.env, UPDATER_DOWNLOAD_BASE_URL: "https://updates.example.com", UPDATER_ARTIFACT_PREFIX: "builds/v0.2.0-build.1" } });
  }
  const output = path.join(folder, "merged.json");
  execFileSync(process.execPath, [path.join(root, ".github/merge-latest-json.mjs"), "0.2.0+1", folder, output], { stdio: "pipe" });
  const manifest = JSON.parse(await readFile(output, "utf8"));
  assert.equal(Object.keys(manifest.platforms).length, 6);
  for (const arch of ["x86_64", "aarch64"]) {
    for (const suffix of ["", "-deb", "-rpm"]) {
      const artifact = manifest.platforms[`linux-${arch}${suffix}`];
      assert.equal(artifact.signature, `test-signature-${arch}`);
      assert.match(artifact.url, /builds\/v0\.2\.0-build\.1\//);
      assert.ok(artifact.url.includes(suffix === "-deb" ? arch === "aarch64" ? "arm64.deb" : "amd64.deb" : arch));
    }
  }
});
