# Contributing to Azalea

Thanks for your interest in contributing!

## Getting started

1. Fork the repository
2. Clone your fork
3. Install the prerequisites listed in the [README](README.md#prerequisites) (Node.js 22+, Rust 1.89+, platform libraries)
4. Run `npm install` from the repo root
5. Run `npm run dev` to start the desktop app in development mode

## Development workflow

- **Frontend**: `apps/desktop/src/` - React + TypeScript
- **Backend**: `apps/desktop/src-tauri/src/` - Rust (SSH, storage, keychain)
- **Shared types**: `packages/shared/`
- **Sync server**: `services/azalea-server/` - Rust (Axum + SQLite)
- **Web dashboard**: `apps/azalea-server-web/` - Next.js

Before submitting a PR:

```bash
npm run typecheck
npm run lint
npm test
npm run build --workspace @azalea/desktop
(cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy && cargo test)
(cd services/azalea-server && cargo fmt --check && cargo clippy && cargo test)
```

## Code style

- Match existing patterns in the file you're editing
- Keep changes focused - one feature or fix per PR
- Rust: run `cargo fmt` before committing

## Reporting issues

Include:

- OS and version
- Azalea version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
