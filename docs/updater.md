# Azalea auto-updater

The desktop app uses [Tauri updater](https://v2.tauri.app/plugin/updater/) with signed releases on **Windows**, **Linux (AppImage)**, and **macOS**.

## Endpoints (in order)

1. `https://azalea.rexsystems.me/updates/latest.json` (hosted update manifest; GitHub repo can stay private)
2. `https://github.com/rexsystems/azalea/releases/latest/download/latest.json` (if the repo is public)

## Platforms in `latest.json`

| Key | Artifact |
|-----|----------|
| `windows-x86_64` | `.nsis.zip` |
| `linux-x86_64` | `.AppImage.tar.gz` |
| `darwin-aarch64` | `.app.tar.gz` (Apple Silicon) |
| `darwin-x86_64` | `.app.tar.gz` (Intel) |

## GitHub Actions secrets (master release only)

Add these repository secrets on `rexsystems/azalea`:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.azalea/tauri-signing.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Your key password |

Generate a new keypair locally:

```bash
npx tauri signer generate -w ~/.azalea/tauri-signing.key -p "your-password" -f
```

The **public** key is already in `apps/desktop/src-tauri/tauri.conf.json`. If you rotate keys, update it there.

macOS builds from CI are **not** Apple Developer ID signed (Gatekeeper may warn). Users can right-click → Open the first time, or clear quarantine. Auto-update still works via Tauri’s own signatures.

CI builds macOS with `--bundles app,dmg` — `app` is required so Tauri can emit the signed `.app.tar.gz` updater payload (DMG alone is not an updater target).

## After each master release

1. CI builds Windows, Linux (deb/rpm/AppImage), and macOS (arm64 + x64 DMG).
2. CI merges platform fragments into `latest.json` and uploads it with the installers to GitHub Releases.
3. Copy `latest.json` to **azalea-web** `public/updates/` so azalea.rexsystems.me serves the manifest:

```bash
cp artifacts/latest.json ../azalea-web/public/updates/latest.json
```

## In the app

Settings → **Updates** → Check for updates.

Updates only work in **release builds** (signed installer / AppImage / app bundle), not in `tauri dev`.
