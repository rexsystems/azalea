# Azalea

Open-source SSH client for Linux, Windows, and macOS. Local-first host and key management, with optional encrypted cloud sync.

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-informational)
[![Release](https://img.shields.io/github/v/release/rexsystems/azalea?label=release&color=brightgreen)](https://github.com/rexsystems/azalea/releases/latest)

## Features

- **SSH terminal** - multi-tab sessions, search, clickable links, local shell
- **Hosts & groups** - password or key auth, reconnect, host key change warnings
- **SSH keys** - generate ed25519 or import existing keys; secrets stay in the OS keychain
- **SFTP** - browse, upload/download, drag-and-drop upload, edit remote text files
- **Port forwarding** - manage and start local forwards from a session
- **Snippets** - save and run common commands
- **Import / export** - Azalea backups, OpenSSH `config`, and JSON host lists
- **Cloud sync** (optional) - vault encrypted on your device before upload; Free / Pro storage caps. See [cloud sync](docs/cloud-sync.md)
- **Self-hosted server** - run your own sync server with Docker, an install script, or the admin CLI. See [self-host](docs/self-host.md)
- **Web dashboard** - login, account and admin pages for a self-hosted server (`apps/azalea-server-web`). See [web apps](docs/web.md)
- **Auto-update** - signed updates on Windows, Linux (AppImage) and macOS. See [updater](docs/updater.md)
- **Themes & settings** - Midnight / Noir, font size, connect screen
- **Terminal AI** (opt-in) - Ask / Agent, command approval, live output, provider model catalogs and custom model IDs. See [AI setup and behavior](docs/ai.md).
- **Voice assistant** (opt-in) - local “Hey Azalea” recognition, voice replies, Wake-on-LAN and background tray support. See [voice setup](docs/voice.md).

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22+ (the desktop tests need it; CI uses 22)
- [Rust](https://rustup.rs/) 1.88+
- **Linux (Fedora / Nobara / RHEL):**
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel dbus-devel curl wget squashfs-tools librsvg2-devel rpm-build alsa-lib-devel cmake clang-devel espeak-ng
  ```
- **Linux (Debian / Ubuntu):**
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libdbus-1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev cmake clang libclang-dev espeak-ng
  ```
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload, CMake and WebView2
- **macOS:** Xcode command-line tools and CMake (`brew install cmake`)

### Setup

```bash
git clone https://github.com/rexsystems/azalea.git
cd azalea
npm install
npm run dev
```

Sync server and web dashboard (optional, for working on sync):

```bash
cd services/azalea-server
AZALEA_JWT_SECRET=dev-secret cargo run    # listens on 0.0.0.0:9482, data in ./data

# second terminal, from the repo root
npm run dev:web                           # proxies /api to http://127.0.0.1:9482
```

### Test

```bash
# Desktop (TypeScript)
npx tsc --noEmit -p apps/desktop
npm run test:ai --workspace @azalea/desktop
node --test apps/desktop/tests/recovery-key.test.mjs

# Desktop (Rust)
cd apps/desktop/src-tauri && cargo test

# Sync server
cd services/azalea-server && cargo test

# Web dashboard and release scripts
npm run test:dashboard
node --test .github/tests/*.test.mjs
```

### Build

```bash
# Local build (unsigned)
npm run build

# CI / signed release build
npm run build:ci

# Linux packages (deb + rpm + AppImage)
npm run build:linux
npm run build:rpm
npm run build:deb

# macOS DMG (run on a Mac)
npm run build:macos
```

Pushes to `master` build **Windows**, **Linux** (deb / rpm / AppImage), and **macOS** (Apple Silicon + Intel) via GitHub Actions. Signed updater manifests are published as `latest.json`.

Output lives under `apps/desktop/src-tauri/target/release/bundle/` (or `target/<triple>/release/bundle/` for cross-arch macOS). See [docs/updater.md](docs/updater.md).

## Project structure

```
azalea/
├── apps/desktop/              # Tauri 2 + React desktop app
│   ├── src/                   # UI
│   └── src-tauri/             # Rust (SSH, SFTP, SQLite, keychain, sync, AI, voice)
├── apps/azalea-server-web/    # Next.js dashboard for self-hosted servers
├── services/azalea-server/    # Self-hostable sync API (Rust + SQLite + Docker)
├── packages/shared/           # Shared TypeScript types
└── docs/                      # Sync, self-host, updater, AI, voice, security
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 |
| UI | React, TypeScript, Tailwind CSS v4 |
| Terminal | xterm.js |
| SSH / SFTP | russh |
| Storage | SQLite + OS keychain |
| Sync | azalea-server (Rust) + client-side encryption |
| Web dashboard | Next.js (static export, served by nginx) |

## Docs

- [Cloud sync](docs/cloud-sync.md)
- [Self-host (VPS / Docker / CLI)](docs/self-host.md)
- [Sync server CLI and env](services/azalea-server/README.md)
- [Sync API v1](docs/sync-api-v1.md)
- [Updater](docs/updater.md)
- [Web apps](docs/web.md)
- [Terminal AI](docs/ai.md)
- [Voice assistant](docs/voice.md)
- [Security model](docs/security.md)
- [Security audit: findings and exceptions](docs/security-audit.md)

## Security

- Private keys and host passwords live in the OS keychain (Secret Service, Keychain, Credential Manager). If no keychain is available, they are stored encrypted on disk instead of in plain text
- Unknown server keys require confirmation on first connect, and key changes must be approved before the saved fingerprint is replaced
- Cloud vault is encrypted client-side (Argon2id + AES-256-GCM) before upload
- The webview runs under a restrictive CSP and cannot read or write arbitrary files
- Optional anonymous telemetry (off by default): daily install ping and short crash reports, no host or key data
- Backup export files are **not** encrypted: they contain private keys and host passwords in plain text

To report a vulnerability, see [docs/security.md](docs/security.md#reporting).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE)
