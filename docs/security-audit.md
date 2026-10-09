# Azalea security audit: findings and exceptions

Known third-party dependency vulnerabilities at the last security review.
Every entry has an acceptance rationale below or a tracked upgrade.

Reproduce the sweep:

```bash
cd services/azalea-server && cargo audit
cd apps/desktop/src-tauri && cargo audit
cd apps/desktop && npm audit --omit=dev
cd apps/azalea-server-web && npm audit --omit=dev
```

`cargo audit` reads from https://github.com/RustSec/advisory-db. Install with
`cargo install cargo-audit` if it is not on your PATH.

## Server (`services/azalea-server`)

Currently clean. Re-run `cargo audit` before every release.

## Desktop (`apps/desktop/src-tauri`)

### Vulnerabilities

| ID | Crate @ Version | Severity | Fixed in | Status |
|---|---|---|---|---|
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071) | `rsa` 0.9.10 | medium 5.9 | no fix available | Accepted |
| [RUSTSEC-2026-0154](https://rustsec.org/advisories/RUSTSEC-2026-0154) | `russh` 0.48.2 | high 7.5 | 0.60.3+ | Planned upgrade |
| [RUSTSEC-2026-0153](https://rustsec.org/advisories/RUSTSEC-2026-0153) | `russh-cryptovec` 0.48.0 | high 7.5 | 0.60.3+ | Planned upgrade (with russh) |

**RUSTSEC-2023-0071 (rsa Marvin attack).** Timing side-channel on PKCS#1 v1.5
RSA decrypt. Exploitation needs many precise timing measurements of RSA
operations. Azalea uses RSA only during SSH host-key verification and when the
user exports or imports an RSA private key locally. The attacker model is a
remote network adversary; they cannot make repeated timing measurements of
local disk-level operations. No fixed release upstream yet. We will pick up the
fix when the `rsa` crate publishes one.

**RUSTSEC-2026-015{3,4} (russh unbounded allocations).** Both are DoS-only: a
malicious SSH server can force the client to allocate an oversized buffer
during KEX. Impact is a client-side crash. Azalea's threat model already
assumes the SSH server the user connects to can be malicious (the shell output
is executed by the user's terminal). Migrating russh 0.48 to 0.63 requires
touching the SSH session code paths; scheduled as a follow-up. Meanwhile, the
desktop app pins strict KEX/cipher/MAC lists to shrink the attack surface (see
`apps/desktop/src-tauri/src/sessions/manager.rs` `strict_ssh_preferences`).

### Warnings (unmaintained / unsound / yanked)

| ID | Crate | Category |
|---|---|---|
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370) | `proc-macro-error` 1.0.4 | unmaintained (build-time only) |
| [RUSTSEC-2025-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081) | `unic-char-property` 0.9.0 | unmaintained (transitive) |
| [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075) | `unic-char-range` 0.9.0 | unmaintained (transitive) |
| [RUSTSEC-2025-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080) | `unic-common` 0.9.0 | unmaintained (transitive) |
| [RUSTSEC-2025-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100) | `unic-ucd-ident` 0.9.0 | unmaintained (transitive) |
| [RUSTSEC-2025-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098) | `unic-ucd-version` 0.9.0 | unmaintained (transitive) |
| [RUSTSEC-2026-0221](https://rustsec.org/advisories/RUSTSEC-2026-0221) | `event-listener` 5.4.1 | unsound (transitive) |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429) | `glib` 0.18.5 | unsound (transitive from tauri) |
| yanked | `chacha20` 0.10.1 | yanked (transitive from `aes-gcm` chain) |
| yanked | `spin` 0.9.8 | yanked (transitive) |

Azalea does not import these directly. They arrive through `tauri`, `russh`,
and the WebKit-GTK bindings. We refresh them when upstream crates publish
supported versions.

## npm

Both `apps/desktop` and `apps/azalea-server-web` report **0 production
vulnerabilities** as of the last audit run.

## How to add an exception

1. Confirm the vulnerability is not exploitable under Azalea's threat model.
   Do not paper over an actively exploitable finding.
2. Add a row to the table above with the RustSec / CVE ID, the crate and pinned
   version, severity, and either the tracked upgrade or the acceptance
   rationale.
3. If the finding is a transitive dep, note the immediate parent crate.
