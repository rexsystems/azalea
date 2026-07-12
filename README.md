# Azalea

A modern, open-source SSH terminal client for Windows (and cross-platform). Local-first host and key management.

![License](https://img.shields.io/badge/license-MIT-purple)
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
- Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload
- WebView2 (preinstalled on Windows 10/11)

### Setup

```bash
git clone https://github.com/your-org/azalea.git
cd azalea
npm install
npm run dev
```

### Build installer (Windows)

```bash
npm run build
```

Output:

- `apps/desktop/src-tauri/target/release/bundle/msi/Azalea_0.1.0_x64_en-US.msi`
- `apps/desktop/src-tauri/target/release/bundle/nsis/Azalea_0.1.0_x64-setup.exe`

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

MIT — see [LICENSE](LICENSE).
