# Azalea auto-updater

The desktop app uses [Tauri updater](https://v2.tauri.app/plugin/updater/) with signed releases on **Windows**, **Linux (AppImage)**, and **macOS**.

Installer binaries and `latest.json` are published to **Cloudflare R2** (`azalea-updates` bucket) behind the custom domain:

`https://updates.azalea.rexsystems.me`

## R2 layout

```
latest.json                              # updater entrypoint (always at root)
builds/v0.1.2-build.72/
  Azalea_0.1.2+72_amd64.AppImage
  Azalea_0.1.2+72_amd64.AppImage.sig
  Azalea_0.1.2+72_amd64.deb
  …
  Azalea.app.tar.gz
  Azalea_0.1.2+72_aarch64.dmg
```

Each release lands in `builds/<git-tag>/`. CI keeps only the live folder (plus `latest.json`) so free-tier storage does not accumulate history. Manual prune: Actions → **Cleanup R2**.

## Endpoints (in order)

1. `https://updates.azalea.rexsystems.me/latest.json` (primary; R2)
2. `https://azalea.rexsystems.me/updates/latest.json` (site fallback)
3. `https://github.com/rexsystems/azalea/releases/latest/download/latest.json` (GitHub fallback)

Download URLs inside the manifest point at `updates.azalea.rexsystems.me/builds/<tag>/<artifact>`.

## Platforms in `latest.json`

| Key | Artifact |
|-----|----------|
| `windows-x86_64` | `.nsis.zip` or setup `.exe` |
| `linux-x86_64` | `.AppImage` / `.AppImage.tar.gz` |
| `linux-x86_64-rpm` | `.rpm` (Fedora / Nobara / RHEL installs) |
| `linux-x86_64-deb` | `.deb` (Debian / Ubuntu installs) |
| `darwin-aarch64` | `.app.tar.gz` (Apple Silicon) |
| `darwin-x86_64` | `.app.tar.gz` (Intel) |

## GitHub Actions secrets

Add these repository secrets on `rexsystems/azalea`:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.azalea/tauri-signing.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Your key password |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API token access key id |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token secret access key |

R2 API tokens: Cloudflare dashboard → R2 → Manage R2 API Tokens → create token with **Object Read & Write** on bucket `azalea-updates`.

Generate a new Tauri keypair locally:

```bash
npx tauri signer generate -w ~/.azalea/tauri-signing.key -p "your-password" -f
```

The **public** key is already in `apps/desktop/src-tauri/tauri.conf.json`. If you rotate keys, update it there.

macOS builds from CI are **not** Apple Developer ID signed (Gatekeeper may warn). Users can right-click → Open the first time, or clear quarantine. Auto-update still works via Tauri’s own signatures.

CI builds macOS with `--bundles app` (signed `.app.tar.gz` for the updater), then packs a DMG via `.github/create-macos-dmg.sh` (plain `hdiutil`, no Finder AppleScript - that step is what usually breaks on GitHub Actions).

## Version + build number

Repo keeps a normal semver core in `tauri.conf.json` (e.g. `0.1.2`).

Each CI release stamps it to `core+N` before building, e.g. `0.1.2+70` or `0.1.3+1`.
`N` is per base version: CI looks at existing tags `v{base}-build.*` and uses max+1.
When you bump the core (`0.1.2` → `0.1.3`), `N` resets to `1`.

That stamped value is what the app reports and what `latest.json` publishes.
Git tags stay URL-safe as `v0.1.3-build.1` (no `+`).

Plain semver treats `+build` as ignored metadata, so Azalea uses a custom
updater comparator that compares the numeric build when major/minor/patch match.
Artifact URLs encode `+` as `%2B`.

## After each master release

1. CI resolves `0.x.y+N`, then builds Windows, Linux (deb/rpm/AppImage), and macOS.
2. CI merges platform fragments into `latest.json` with download URLs under `https://updates.azalea.rexsystems.me/builds/<tag>/…`.
3. CI uploads installers into `builds/<tag>/` and writes `latest.json` at the bucket root, then prunes older build folders.
4. CI also attaches the same files to the GitHub Release (archive / fallback).
5. Optionally copy `latest.json` into **azalea-web** `public/updates/` so the marketing site fallback stays in sync:

```bash
cp artifacts/latest.json ../azalea-web/public/updates/latest.json
```

## Manual seed (first time / before next CI run)

Until the next master release uploads automatically, put the current release assets and manifest on R2:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=auto
ENDPOINT=https://f92074baafe52a6a6b5b47c82488090d.r2.cloudflarestorage.com

# Upload one release folder + root manifest
TAG=v0.1.2-build.72
aws s3 sync "./$TAG/" "s3://azalea-updates/builds/$TAG/" --endpoint-url "$ENDPOINT"
aws s3 cp latest.json s3://azalea-updates/latest.json \
  --endpoint-url "$ENDPOINT" \
  --content-type application/json \
  --cache-control "public, max-age=60"
# Optional: prune everything except the live build folder
node .github/cleanup-r2.mjs
```

Confirm: `https://updates.azalea.rexsystems.me/latest.json`

## In the app

Settings → **Updates** → Check for updates.

Updates only work in **release builds** (signed installer / AppImage / app bundle), not in `tauri dev`.
