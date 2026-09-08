use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod db;
mod error;
mod mail;
mod routes;
mod state;

use state::AppState;
use crate::mail::MailConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("azalea_server=info".parse()?))
        .init();

    let data_dir = PathBuf::from(env::var("AZALEA_DATA_DIR").unwrap_or_else(|_| "./data".into()));
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("azalea.db");

    let jwt_secret = env::var("AZALEA_JWT_SECRET").unwrap_or_else(|_| {
        tracing::warn!("AZALEA_JWT_SECRET not set; using ephemeral secret (dev only)");
        hex::encode(rand::random::<[u8; 32]>())
    });
    let setup_secret = env::var("AZALEA_SETUP_SECRET").ok();
    let bind = env::var("AZALEA_BIND").unwrap_or_else(|_| "0.0.0.0:8787".into());

    let db = db::Database::open(&db_path)?;
    db.migrate()?;

    let mail = MailConfig::from_env();
    if mail.is_some() {
        tracing::info!("Resend mail configured");
    } else {
        tracing::warn!("RESEND_API_KEY not set; password reset emails disabled");
    }

    let state = Arc::new(AppState {
        db,
        jwt_secret,
        setup_secret,
        mail,
    });

    let app = Router::new()
        .merge(routes::router())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = bind.parse()?;
    tracing::info!("azalea-server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
