use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use axum::http::header::{HeaderName, HeaderValue};
use axum::http::Method;
use axum::Router;
use clap::Parser;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod captcha;
mod cli;
mod db;
mod error;
mod mail;
mod ratelimit;
mod routes;
mod state;

use crate::mail::MailConfig;
use cli::{Cli, Command};
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    let cli = Cli::parse();
    match cli.command {
        None | Some(Command::Serve) => run_serve().await,
        Some(cmd) => cli::run_cli(cmd),
    }
}

async fn run_serve() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("azalea_server=info".parse()?))
        .init();

    let data_dir = PathBuf::from(env::var("AZALEA_DATA_DIR").unwrap_or_else(|_| "./data".into()));
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("azalea.db");

    let env_name = env::var("AZALEA_ENV").unwrap_or_else(|_| "prod".into());
    let is_dev = env_name.eq_ignore_ascii_case("dev");

    let jwt_secret = match env::var("AZALEA_JWT_SECRET") {
        Ok(v) if !v.is_empty() => v,
        _ if is_dev => {
            tracing::warn!(
                "AZALEA_JWT_SECRET not set; using ephemeral secret (AZALEA_ENV=dev)"
            );
            hex::encode(rand::random::<[u8; 32]>())
        }
        _ => {
            anyhow::bail!(
                "AZALEA_JWT_SECRET is required in production. Set AZALEA_ENV=dev to allow an ephemeral secret."
            );
        }
    };

    let bind = env::var("AZALEA_BIND").unwrap_or_else(|_| "0.0.0.0:9482".into());
    let addr: SocketAddr = bind.parse()?;

    let allow_insecure_cookie = env::var("AZALEA_ALLOW_INSECURE_COOKIE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if allow_insecure_cookie && !addr.ip().is_loopback() {
        anyhow::bail!(
            "AZALEA_ALLOW_INSECURE_COOKIE is only valid when AZALEA_BIND is loopback (127.0.0.1)"
        );
    }

    let allowed_origins: Vec<String> = env::var("AZALEA_ALLOWED_ORIGINS")
        .ok()
        .map(|raw| {
            raw.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let db = db::Database::open(&db_path)?;
    db.migrate()?;

    let mail = MailConfig::from_env();
    if mail.is_some() {
        tracing::info!("Resend mail configured");
    } else {
        tracing::warn!("RESEND_API_KEY not set; password reset emails disabled");
    }

    let limiters = AppState::default_limiters();
    let state = Arc::new(AppState {
        db,
        jwt_secret,
        mail,
        allowed_origins: allowed_origins.clone(),
        allow_insecure_cookie,
        auth_login_limiter: limiters.login,
        auth_write_limiter: limiters.write,
        auth_refresh_limiter: limiters.refresh,
        auth_identifier_limiter: limiters.identifier,
    });

    let mut app = Router::new().merge(routes::router());

    if !allowed_origins.is_empty() {
        let origins: Vec<HeaderValue> = allowed_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        let cors = CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_credentials(true)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([
                HeaderName::from_static("authorization"),
                HeaderName::from_static("content-type"),
                HeaderName::from_static("x-azalea-client"),
                HeaderName::from_static("x-azalea-aad-tag"),
            ]);
        app = app.layer(cors);
        tracing::info!(?allowed_origins, "CORS enabled for allowlist");
    } else {
        tracing::info!("CORS disabled (same-origin only); set AZALEA_ALLOWED_ORIGINS to enable");
    }

    let app = app
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!("azalea-server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

// Silence unused import warning when only used inside builder above.
#[allow(dead_code)]
fn _ensure_from_str<T: FromStr>() {}
