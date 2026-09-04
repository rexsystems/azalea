# Azalea

Open-source SSH client for Linux, Windows, and macOS. Local-first host and key management, with optional encrypted cloud sync.

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-informational)
![Version](https://img.shields.io/badge/version-0.1.1-brightgreen)

## Features

- **SSH terminal** — multi-tab sessions, search, clickable links, local shell
- **Hosts & groups** — password or key auth, reconnect, host key change warnings
- **SSH keys** — generate ed25519 or import existing keys; secrets stay in the OS keychain
- **SFTP** — browse, upload/download, drag-and-drop upload, edit remote text files
- **Port forwarding** — manage and start local forwards from a session
- **Snippets** — save and run common commands
- **Import / export** — Azalea backups, OpenSSH `config`, and JSON host lists
- **Cloud sync** (optional) — zero-knowledge encrypted vault; Free / Pro storage caps
- **Themes & settings** — Midnight / Noir, font size, connect screen, auto-update

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.77+
- **Linux (Fedora / Nobara / RHEL):**
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel dbus-devel curl wget squashfs-tools librsvg2-devel rpm-build
  ```
- **Linux (Debian / Ubuntu):**
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libdbus-1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload and WebView2

### Setup

```bash
git clone https://github.com/rexsystems/azalea.git
cd azalea
npm install
npm run dev
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
├── apps/desktop/          # Tauri 2 + React desktop app
│   ├── src/               # UI
│   └── src-tauri/         # Rust (SSH, SFTP, SQLite, keychain, sync)
├── apps/azalea-web/       # Marketing / account site (optional local link)
├── packages/shared/       # Shared TypeScript types
├── supabase/              # Schema and plan SQL
└── docs/                  # Sync, updater, web notes
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Tauri 2 |
| UI | React, TypeScript, Tailwind CSS v4 |
| Terminal | xterm.js |
| SSH / SFTP | russh |
| Storage | SQLite + OS keychain |
| Sync | Supabase + client-side encryption |

## Docs

- [Cloud sync](docs/cloud-sync.md)
- [Updater](docs/updater.md)
- [Web app](docs/web.md)
- [Supabase setup](supabase/SETUP.md)

## Security

- Private keys and host passwords live in the OS keychain (Secret Service, Keychain, Credential Manager). If no keychain is available, they are stored encrypted on disk instead of in plain text
- Unknown server keys require confirmation on first connect, and key changes must be approved before the saved fingerprint is replaced
- Cloud vault is encrypted client-side (Argon2id + AES-256-GCM) before upload
- The webview runs under a restrictive CSP and cannot read or write arbitrary files
- No telemetry
- Backup export files are **not** encrypted: they contain private keys and host passwords in plain text

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE)
