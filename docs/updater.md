# Azalea auto-updater

The desktop app uses [Tauri updater](https://v2.tauri.app/plugin/updater/) with signed releases.

## Endpoints (in order)

1. `https://azalea.rexsystems.me/updates/latest.json` (hosted update manifest; GitHub repo can stay private)
2. `https://github.com/rexsystems/azalea/releases/latest/download/latest.json` (if the repo is public)

## GitHub Actions secrets (master release only)

Add these repository secrets on `rexsystems/azalea`:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `~/.azalea/tauri-signing.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `azalea` (or your chosen password) |

Generate a new keypair locally:

```powershell
npx tauri signer generate -w "$env:USERPROFILE\.azalea\tauri-signing.key" --ci -p "your-password" -f
```

The **public** key is already in `apps/desktop/src-tauri/tauri.conf.json`. If you rotate keys, update it there.

## After each master release

1. CI uploads `latest.json`, `*.nsis.zip`, and signatures to GitHub Releases.
2. Copy `latest.json` (and optionally the installer zip) to **azalea-web** `public/updates/` so the site at **azalea.rexsystems.me** serves the manifest.

```powershell
copy apps\desktop\src-tauri\target\release\bundle\nsis\latest.json ..\azalea-web\public\updates\latest.json
```

## In the app

Settings → **Updates** → Check for updates.

Updates only work in **release builds** (signed installer), not in `tauri dev`.
