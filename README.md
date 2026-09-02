# Azalea

A modern, open-source SSH terminal client for Windows (and cross-platform). Local-first host and key management.

![License](https://img.shields.io/badge/license-AGPL--3.0-purple)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

## Features (v0.1)

- **SSH terminal** — multi-tab sessions with xterm.js
- **Host manager** — save connections with groups, password or key auth
- **SSH key manager** — generate ed25519 keys or import existing ones
- **Secure storage** — passwords and private keys in OS keychain (Windows Credential Manager)
- **Local-first** — SQLite database, no cloud sync (planned for v0.2)
- **Keyboard shortcuts** — `Ctrl+T` new tab, `Ctrl+W` close tab

## Screenshots

> Run the app and add your first host to get started.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) 1.77+
- **Linux (Fedora / Nobara / RHEL):**
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget squashfs-tools librsvg2-devel rpm-build
  ```
- **Linux (Debian / Ubuntu):**
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload and WebView2

### Setup

```bash
git clone https://github.com/rexsystems/azalea.git
cd azalea
npm install
npm run dev
```

### Build installer & packages

```bash
# Local build (unsigned)
npm run build

# CI / signed release build
npm run build:ci

# Linux packages only (deb + rpm)
npm run build:linux

# Or build specific Linux packages:
npm run build:rpm   # Fedora / RHEL / openSUSE
npm run build:deb   # Debian / Ubuntu
```

Pushes to `master` build **Windows**, **deb** (Ubuntu/Debian), and **rpm** (Fedora/RHEL) via GitHub Actions.

Output:

- Linux RPM: `apps/desktop/src-tauri/target/release/bundle/rpm/Azalea-*.rpm`
- Linux DEB: `apps/desktop/src-tauri/target/release/bundle/deb/Azalea_*.deb`
- Windows: `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe` or `msi/*.msi`

## Project structure

```
azalea/
├── apps/desktop/          # Tauri 2 + React app
│   ├── src/               # React UI
│   └── src-tauri/         # Rust backend (SSH, SQLite, keychain)
├── packages/shared/       # Shared TypeScript types
└── .github/workflows/     # CI
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri 2 |
| UI | React, TypeScript, Tailwind CSS v4 |
| Terminal | xterm.js |
| SSH | russh (Rust) |
| Storage | SQLite + OS keychain |

## Roadmap

- [ ] Cloud sync (self-hosted, E2E encrypted)
- [ ] SFTP file browser
- [ ] Port forwarding
- [ ] Snippets and automation
- [ ] Team sharing

## Security

- Private keys never stored in plain text on disk
- Host passwords stored in OS keychain
- No telemetry or phone-home
- Server host key verification accepts all keys in v0.1 (pinning planned)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

AGPL-3.0 - see [LICENSE](LICENSE).
