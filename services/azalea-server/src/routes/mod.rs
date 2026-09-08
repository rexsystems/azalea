mod admin;
mod auth_routes;
mod extractors;
mod setup;
mod vault;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/health", get(health))
        .merge(setup::router())
        .merge(auth_routes::router())
        .merge(vault::router())
        .merge(admin::router())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "mail_configured": state.mail.is_some(),
    }))
}
