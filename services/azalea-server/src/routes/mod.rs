mod admin;
mod auth_routes;
mod extractors;
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
        .merge(auth_routes::router())
        .merge(vault::router())
        .merge(admin::router())
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let instance_name = state
        .db
        .with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT instance_name FROM settings WHERE id = 1",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_else(|_| "Azalea".into()))
        })
        .unwrap_or_else(|_| "Azalea".into());

    Json(json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "mail_configured": state.mail.is_some(),
        "instance_name": instance_name,
    }))
}
