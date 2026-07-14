# Contributing to Azalea

Thanks for your interest in contributing!

## Getting started

1. Fork the repository
2. Clone your fork
3. Run `npm install` from the repo root
4. Run `npm run dev` to start the desktop app in development mode

## Development workflow

- **Frontend**: `apps/desktop/src/` — React + TypeScript
- **Backend**: `apps/desktop/src-tauri/src/` — Rust (SSH, storage, keychain)
- **Shared types**: `packages/shared/`

Before submitting a PR:

```bash
cd apps/desktop
npm run build
cd src-tauri
cargo clippy
cargo test
```

## Code style

- Match existing patterns in the file you're editing
- Keep changes focused — one feature or fix per PR
- Rust: run `cargo fmt` before committing

## Reporting issues

Include:

- OS and version
- Azalea version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
