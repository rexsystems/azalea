use crate::{auth::issue_access_token, db::Database, state::AppState};
use axum::http::StatusCode;
use reqwest::Method;
use serde_json::{json, Value};
use std::sync::Arc;

struct Fixture {
    state: Arc<AppState>,
    url: String,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Fixture {
    async fn new() -> Self {
        let db = Database::open(std::path::Path::new(":memory:")).unwrap();
        db.migrate().unwrap();
        db.with_conn(|conn| {
            conn.execute_batch("INSERT INTO users(id,email,password_hash,role,created_at,updated_at) VALUES('admin','admin@example.com','unused','admin','now','now'),('user','user@example.com','unused','user','now','now')")?;
            Ok(())
        }).unwrap();
        let limits = AppState::default_limiters();
        let state = Arc::new(AppState {
            ai: crate::ai::AiRuntime::new("tests").unwrap(),
            db,
            jwt_secret: "test-secret".into(),
            mail: None,
            allowed_origins: vec![],
            allow_insecure_cookie: true,
            cookie_path: "/".into(),
            auth_login_limiter: limits.login,
            auth_write_limiter: limits.write,
            auth_refresh_limiter: limits.refresh,
            auth_identifier_limiter: limits.identifier,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = crate::routes::router().with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { state, url, server }
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        user: &str,
        body: Value,
    ) -> reqwest::Response {
        let role = if user == "admin" { "admin" } else { "user" };
        let token = issue_access_token(&self.state.jwt_secret, user, user, role, 600).unwrap();
        reqwest::Client::new()
            .request(method, format!("{}{path}", self.url))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .unwrap()
    }
    async fn account(&self) -> Value {
        self.request(Method::GET, "/v1/account", "user", json!(null))
            .await
            .json()
            .await
            .unwrap()
    }
    async fn upload(&self, version: i64, bytes: usize) -> reqwest::Response {
        self.request(Method::PUT,"/v1/vault","user",json!({"expected_version":version,"kdf_salt":"salt","verifier":"verifier","ciphertext":"x".repeat(bytes)})).await
    }
}

#[tokio::test]
async fn custom_plans_and_user_overrides_control_real_uploads() {
    let f = Fixture::new().await;
    for (id, quota) in [("team", 2048), ("small", 1024)] {
        assert_eq!(
            f.request(
                Method::POST,
                "/v1/admin/plans",
                "admin",
                json!({"id":id,"name":id,"limit_bytes":quota})
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/user",
            "admin",
            json!({"plan":"team"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.account().await["plan"], "team");
    assert_eq!(f.account().await["vault_limit_bytes"], 2048);
    assert_eq!(f.upload(0, 1500).await.status(), StatusCode::OK);
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/plans/team",
            "admin",
            json!({"name":"Team renamed","limit_bytes":1024})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.account().await["plan_name"], "Team renamed");
    assert_eq!(f.account().await["vault_limit_bytes"], 1024);
    assert_eq!(
        f.upload(1, 1500).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let saved: Value = f
        .request(Method::GET, "/v1/vault", "user", json!(null))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(saved["version"], 1);
    assert_eq!(saved["ciphertext"].as_str().unwrap().len(), 1500);
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/user",
            "admin",
            json!({"quota_override_bytes":4096})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.upload(1, 3000).await.status(), StatusCode::OK);
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/user",
            "admin",
            json!({"plan":"small"})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.account().await["vault_limit_bytes"], 4096);
    assert_eq!(f.upload(2, 3000).await.status(), StatusCode::OK);
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/user",
            "admin",
            json!({"reset_quota":true})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.account().await["vault_limit_bytes"], 1024);
    assert_eq!(
        f.upload(3, 3000).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(f.upload(3, 100).await.status(), StatusCode::OK);
    assert_eq!(f.upload(3, 100).await.status(), StatusCode::CONFLICT);
    assert_eq!(
        f.request(
            Method::DELETE,
            "/v1/admin/plans/small",
            "admin",
            json!(null)
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.request(Method::DELETE, "/v1/admin/plans/team", "admin", json!(null))
            .await
            .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn plan_validation_permissions_and_default_plans_are_enforced() {
    let f = Fixture::new().await;
    for path in ["/v1/admin/plans", "/v1/admin/users"] {
        assert_eq!(
            f.request(Method::GET, path, "user", json!(null))
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
    }
    for body in [
        json!({"id":"personal","name":"Reserved","limit_bytes":1024}),
        json!({"id":"Team!","name":"Bad ID","limit_bytes":1024}),
        json!({"id":"team","name":"","limit_bytes":1024}),
        json!({"id":"team","name":"Team","limit_bytes":0}),
    ] {
        assert_eq!(
            f.request(Method::POST, "/v1/admin/plans", "admin", body)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    for body in [
        json!({"plan":"missing"}),
        json!({"quota_override_bytes":0}),
        json!({"quota_override_bytes":2048,"reset_quota":true}),
    ] {
        assert_eq!(
            f.request(Method::PATCH, "/v1/admin/users/user", "admin", body)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        f.request(Method::DELETE, "/v1/admin/plans/free", "admin", json!(null))
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/admin",
            "admin",
            json!({"role":"user"})
        )
        .await
        .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.request(
            Method::POST,
            "/v1/admin/plans",
            "admin",
            json!({"id":"free","name":"Duplicate","limit_bytes":1024})
        )
        .await
        .status(),
        StatusCode::CONFLICT
    );
    let created=f.request(Method::POST,"/v1/admin/users","admin",json!({"email":"new@example.com","password":"test-password","plan":"pro","quota_override_bytes":4096})).await;
    assert_eq!(created.status(), StatusCode::OK);
    assert_eq!(
        created.json::<Value>().await.unwrap()["vault_limit_bytes"],
        4096
    );
    let users: Value = f
        .request(Method::GET, "/v1/admin/users", "admin", json!(null))
        .await
        .json()
        .await
        .unwrap();
    assert!(users
        .as_array()
        .unwrap()
        .iter()
        .all(|u| u["vault_limit_bytes"].is_number()));
}

#[tokio::test]
async fn closed_signup_blocks_registration_but_not_admin_created_accounts() {
    let f = Fixture::new().await;
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/settings",
            "admin",
            json!({"signup_enabled":false})
        )
        .await
        .status(),
        StatusCode::OK
    );
    let config: Value = f
        .request(Method::GET, "/v1/auth/config", "user", json!(null))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(config["signup_enabled"], false);
    assert_eq!(
        f.request(
            Method::POST,
            "/v1/auth/register",
            "user",
            json!({"email":"signup@example.com","password":"test-password"})
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.request(
            Method::POST,
            "/v1/admin/users",
            "admin",
            json!({"email":"managed@example.com","password":"test-password","plan":"free"})
        )
        .await
        .status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn uploads_above_the_framework_default_follow_the_user_quota() {
    let f = Fixture::new().await;
    assert_eq!(
        f.request(
            Method::PATCH,
            "/v1/admin/users/user",
            "admin",
            json!({"quota_override_bytes":4194304})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(f.upload(0, 3 * 1024 * 1024).await.status(), StatusCode::OK);
    assert_eq!(
        f.upload(1, 5 * 1024 * 1024).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}
