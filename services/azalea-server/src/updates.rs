use std::{fs, io::Write, path::{Path, PathBuf}, sync::Arc};

use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{error::{ApiError, ApiResult}, routes::extractors::AdminUser, state::AppState};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/admin/updates", get(status))
        .route("/v1/admin/updates/check", post(check))
        .route("/v1/admin/updates/apply", post(apply))
        .route("/v1/admin/updates/rollback", post(rollback))
}

fn directory() -> Option<PathBuf> {
    std::env::var_os("AZALEA_UPDATE_DIR").filter(|value| !value.is_empty()).map(PathBuf::from)
}

pub fn read_status_at(directory: Option<&Path>) -> ApiResult<Value> {
    let mut status = if let Some(directory) = directory {
        let path = directory.join("status.json");
        match fs::metadata(&path) {
            Ok(meta) if meta.len() <= 65536 => serde_json::from_slice::<Value>(&fs::read(path)?).unwrap_or(json!({})),
            Ok(_) => json!({}),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
            Err(error) => return Err(anyhow::Error::from(error).into()),
        }
    } else { json!({}) };
    if !status.is_object() { status = json!({}); }
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    let connected = status["heartbeat"].as_u64().is_some_and(|heartbeat| heartbeat <= now + 5 && now.saturating_sub(heartbeat) <= 45);
    status["connected"] = json!(connected);
    status["version"] = json!(env!("CARGO_PKG_VERSION"));
    status["revision"] = json!(option_env!("AZALEA_BUILD_REVISION").unwrap_or("local"));
    if status.get("phase").is_none() { status["phase"] = json!("idle"); }
    if !connected { status["message"] = json!("Enable the host update manager to check, update or roll back this installation."); }
    Ok(status)
}

pub fn current_status() -> ApiResult<Value> { read_status_at(directory().as_deref()) }

pub fn enqueue_at(directory: &Path, action: &str, selection: Option<&str>, requested_by: &str) -> ApiResult<Value> {
    let status = read_status_at(Some(directory))?;
    if status["connected"] != true { return Err(ApiError::Conflict("The host update manager is offline.".into())); }
    if !["idle", "succeeded", "failed"].contains(&status["phase"].as_str().unwrap_or("")) {
        return Err(ApiError::Conflict("An update operation is already running.".into()));
    }
    match action {
        "check" => {},
        "apply" if status["available"] == true && selection == status["check_id"].as_str() => {},
        "rollback" if status["rollback_available"] == true && selection == status["backup_id"].as_str() => {},
        "apply" | "rollback" => return Err(ApiError::Conflict("Refresh the update status before continuing.".into())),
        _ => return Err(ApiError::BadRequest("Unknown update action.".into())),
    }
    let id = uuid::Uuid::new_v4().to_string();
    let body = json!({"id":id,"action":action,"selection":selection,"requested_by":requested_by,"issued_at":chrono::Utc::now().timestamp()});
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(directory.join("request.json"))
        .map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { ApiError::Conflict("An update request is already queued.".into()) } else { anyhow::Error::from(error).into() })?;
    file.write_all(serde_json::to_vec(&body)?.as_slice())?;
    file.sync_all()?;
    Ok(json!({"id":id,"queued":true}))
}

pub fn request_action(action: &str, selection: Option<&str>, requested_by: &str) -> ApiResult<Value> {
    let directory = directory().ok_or_else(|| ApiError::Conflict("The host update manager is not enabled.".into()))?;
    enqueue_at(&directory, action, selection, requested_by)
}

async fn status(_admin: AdminUser) -> ApiResult<Json<Value>> { Ok(Json(current_status()?)) }
async fn check(_admin: AdminUser, State(_state): State<Arc<AppState>>) -> ApiResult<Json<Value>> { Ok(Json(request_action("check", None, &_admin.0.sub)?)) }

#[derive(Deserialize)]
struct Selection { selection: String }

async fn apply(admin: AdminUser, Json(body): Json<Selection>) -> ApiResult<Json<Value>> { Ok(Json(request_action("apply", Some(&body.selection), &admin.0.sub)?)) }
async fn rollback(admin: AdminUser, Json(body): Json<Selection>) -> ApiResult<Json<Value>> { Ok(Json(request_action("rollback", Some(&body.selection), &admin.0.sub)?)) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_requests_require_live_manager_reviewed_target_and_single_queue_slot() {
        let path = std::env::temp_dir().join(format!("azalea-updates-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        assert!(enqueue_at(&path, "check", None, "admin").is_err());
        let state = json!({"heartbeat":chrono::Utc::now().timestamp(),"phase":"idle","available":true,"check_id":"reviewed"});
        fs::write(path.join("status.json"), serde_json::to_vec(&state).unwrap()).unwrap();
        assert!(enqueue_at(&path, "apply", Some("outdated"), "admin").is_err());
        assert!(enqueue_at(&path, "apply", Some("reviewed"), "admin").is_ok());
        assert!(enqueue_at(&path, "check", None, "admin").is_err());
        fs::remove_file(path.join("request.json")).unwrap();
        fs::remove_file(path.join("status.json")).unwrap();
        fs::remove_dir(path).unwrap();
    }
}
