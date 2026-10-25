glib 0.18.5 security backport

Tauri 2 depends on GTK 3, which requires glib 0.18. This local patch backports
the mutable out-pointer fix for RUSTSEC-2024-0429 from upstream:
https://github.com/gtk-rs/gtk-rs-core/pull/1343

Only src/variant_iter.rs differs from the published crate: impl_get uses a
mutable pointer and passes &mut p to g_variant_get_child. Existing iterator
tests exercise this path; run them with optimization to catch the original bug:

    cargo test --release --manifest-path patches/glib/Cargo.toml variant_iter

Remove this patch when Tauri supports a fixed upstream glib version. The
version remains 0.18.5, so version-based scanners may continue to report the
advisory despite the backport. Do not suppress it globally.
