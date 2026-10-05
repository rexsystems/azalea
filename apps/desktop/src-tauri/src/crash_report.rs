//! Opt-in crash reporting to GlitchTip (Sentry-compatible).
//!
//! The Sentry client is always initialized so panics can be captured.
//! `before_send` drops events until the user enables telemetry.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use sentry::{ClientInitGuard, ClientOptions, Level};
use serde::Deserialize;

/// Public client DSN for https://error.mythical.systems (GlitchTip).
const GLITCHTIP_DSN: &str =
    "https://f201d7b7760e4107bd214cbb8673eadf@error.mythical.systems/3";

static REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);

fn redact(text: &str) -> String {
    let mut out = text.to_string();
    // emails
    out = out
        .split_whitespace()
        .map(|tok| {
            if tok.contains('@') && tok.contains('.') {
                "[email]"
            } else {
                tok
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    // IPv4
    out = out
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .map(|tok| {
            let trimmed = tok.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
            if is_ipv4(trimmed) {
                "[ip]"
            } else {
                tok
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    for marker in ["/home/", "/Users/", "/root/"] {
        while let Some(idx) = out.find(marker) {
            let after = idx + marker.len();
            let rest = &out[after..];
            let end = rest
                .find(|c: char| c == '/' || c == '\\' || c.is_whitespace() || c == '"' || c == '\'')
                .map(|i| after + i)
                .unwrap_or(out.len());
            out.replace_range(idx..end, &format!("{marker}[user]"));
            break;
        }
    }
    out.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(800)
        .collect()
}

fn is_ipv4(s: &str) -> bool {
    let parts: Vec<_> = s.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Call once at process start; keep the returned guard for the app lifetime.
pub fn init_sentry() -> ClientInitGuard {
    sentry::init((
        GLITCHTIP_DSN,
        ClientOptions {
            release: sentry::release_name!(),
            traces_sample_rate: 0.0,
            send_default_pii: false,
            attach_stacktrace: true,
            before_send: Some(Arc::new(|event| {
                if REPORTING_ENABLED.load(Ordering::Relaxed) {
                    Some(event)
                } else {
                    None
                }
            })),
            ..Default::default()
        },
    ))
}

#[tauri::command]
pub fn set_crash_reporting_enabled(enabled: bool) {
    REPORTING_ENABLED.store(enabled, Ordering::Relaxed);
    if enabled {
        sentry::configure_scope(|scope| {
            scope.set_tag("product", "azalea-desktop");
        });
    }
}

#[derive(Debug, Deserialize)]
pub struct ClientErrorInput {
    pub kind: String,
    pub message: String,
    pub stack: Option<String>,
}

#[tauri::command]
pub fn report_client_error(input: ClientErrorInput) {
    if !REPORTING_ENABLED.load(Ordering::Relaxed) {
        return;
    }
    let kind = match input.kind.as_str() {
        "js_error" | "js_unhandledrejection" | "react_boundary" | "rust_panic" | "native" => {
            input.kind.clone()
        }
        _ => "unknown".into(),
    };
    let message = redact(&input.message);
    if message.is_empty() {
        return;
    }
    let stack = input
        .stack
        .as_deref()
        .map(redact)
        .filter(|s| !s.is_empty());

    sentry::with_scope(
        |scope| {
            scope.set_tag("source", "frontend");
            scope.set_tag("kind", &kind);
            if let Some(ref s) = stack {
                scope.set_extra("stack", s.clone().into());
            }
        },
        || {
            sentry::capture_message(&message, Level::Error);
        },
    );
}
