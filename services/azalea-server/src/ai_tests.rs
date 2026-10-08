use super::*;
use crate::{auth::issue_access_token, db::Database};

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
            for (id, role, disabled) in [("admin", "admin", 0), ("user", "user", 0), ("disabled", "user", 1)] {
                conn.execute("INSERT INTO users(id,email,password_hash,role,disabled,created_at,updated_at) VALUES(?1,?1,'unused',?2,?3,'now','now')", params![id, role, disabled])?;
            }
            Ok(())
        }).unwrap();
        let limits = AppState::default_limiters();
        let state = Arc::new(AppState {
            ai: AiRuntime {
                key: [7; 32],
                http: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .unwrap(),
                slots: Arc::new(Semaphore::new(8)),
            },
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

    fn request(&self, method: reqwest::Method, path: &str, user: &str) -> reqwest::RequestBuilder {
        let role = if user == "admin" { "admin" } else { "user" };
        let jwt = issue_access_token(&self.state.jwt_secret, user, user, role, 600).unwrap();
        reqwest::Client::new()
            .request(method, format!("{}{path}", self.url))
            .bearer_auth(jwt)
    }

    async fn save(&self, body: &Value) -> reqwest::Response {
        self.request(reqwest::Method::PUT, "/v1/admin/ai", "admin")
            .json(body)
            .send()
            .await
            .unwrap()
    }
}

fn settings(base: &str) -> Value {
    json!({"enabled":true,"default_model":"test::real-model","requests_per_minute":1,"max_output_tokens":512,
        "providers":[{"id":"test","name":"Test provider","provider":"custom_openai","dialect":"openai","base_url":base,
            "api_key":"provider-secret","models":[{"id":"real-model","label":"Real model"}]}]})
}

#[tokio::test]
async fn credentials_are_encrypted_masked_and_bound_to_the_saved_endpoint() {
    let fixture = Fixture::new().await;
    let mut config = settings("http://127.0.0.1:1234/v1");
    let response = fixture.save(&config).await;
    assert_eq!(response.status(), StatusCode::OK);
    let text = response.text().await.unwrap();
    assert!(!text.contains("provider-secret"));
    assert!(text.contains("\"key_configured\":true"));
    let records = read_records(&fixture.state).unwrap();
    assert!(!records[0].ciphertext.contains("provider-secret"));
    assert_eq!(
        provider_key(&fixture.state, &records[0]).unwrap(),
        "provider-secret"
    );
    assert!(fixture
        .state
        .ai
        .decrypt(&records[0].ciphertext, "wrong endpoint")
        .is_err());
    config["providers"][0]
        .as_object_mut()
        .unwrap()
        .remove("api_key");
    assert_eq!(fixture.save(&config).await.status(), StatusCode::OK);
    config["providers"][0]["base_url"] = json!("http://127.0.0.1:5678/v1");
    assert_eq!(
        fixture.save(&config).await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        read_settings(&fixture.state).unwrap().providers[0].base_url,
        "http://127.0.0.1:1234/v1"
    );
    config["providers"][0]["api_key"] = json!("replacement");
    assert_eq!(fixture.save(&config).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn permissions_and_model_validation_apply_before_upstream_requests() {
    let fixture = Fixture::new().await;
    let no_auth = reqwest::get(format!("{}/v1/admin/ai", fixture.url))
        .await
        .unwrap();
    assert_eq!(no_auth.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        fixture
            .request(reqwest::Method::GET, "/v1/admin/ai", "user")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        fixture
            .request(reqwest::Method::GET, "/v1/ai/config", "disabled")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        fixture
            .save(&settings("http://127.0.0.1:1234/v1"))
            .await
            .status(),
        StatusCode::OK
    );
    let response = fixture
        .request(reqwest::Method::GET, "/v1/ai/config", "user")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(response.contains("test::real-model"));
    assert!(!response.contains("provider-secret"));
    assert!(!response.contains("base_url"));
    let response = fixture
        .request(reqwest::Method::POST, "/v1/ai/chat/completions", "user")
        .json(&json!({"model":"invented","messages":[{"role":"user","content":"hi"}]}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let mut invalid = settings("http://[2001:4860:4860::8888]/v1");
    assert_eq!(
        fixture.save(&invalid).await.status(),
        StatusCode::BAD_REQUEST
    );
    invalid["providers"][0]["base_url"] = json!("http://[fd00::1]/v1");
    assert_eq!(fixture.save(&invalid).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn proxy_forwards_real_model_and_provider_key_streams_and_enforces_limits() {
    let fixture = Fixture::new().await;
    let provider = Router::new().route(
        "/v1/chat/completions",
        post(
            |headers: axum::http::HeaderMap, Json(body): Json<Value>| async move {
                assert_eq!(headers[header::AUTHORIZATION], "Bearer provider-secret");
                assert_eq!(body["model"], "real-model");
                assert_eq!(body["max_tokens"], 512);
                assert!(body.get("api_key").is_none());
                (
                    [(header::CONTENT_TYPE, "text/event-stream")],
                    "data: {\"choices\":[]}\n\ndata: [DONE]\n\n",
                )
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let mock = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    assert_eq!(
        fixture.save(&settings(&base)).await.status(),
        StatusCode::OK
    );
    let body = json!({"stream":true,"api_key":"do-not-forward","max_tokens":99999,"messages":[{"role":"user","content":"hi"}]});
    let response = fixture
        .request(reqwest::Method::POST, "/v1/ai/chat/completions", "user")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(
        response.text().await.unwrap(),
        "data: {\"choices\":[]}\n\ndata: [DONE]\n\n"
    );
    assert_eq!(fixture.state.ai.slots.available_permits(), 8);
    assert_eq!(
        fixture
            .request(reqwest::Method::POST, "/v1/ai/chat/completions", "user")
            .json(&body)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    mock.abort();
}

#[tokio::test]
async fn admin_updates_are_atomic_and_cannot_remove_the_last_active_admin() {
    let fixture = Fixture::new().await;
    let invalid = fixture
        .request(reqwest::Method::PATCH, "/v1/admin/users/user", "admin")
        .json(&json!({"disabled":true,"password":"short"}))
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let disabled = fixture
        .state
        .db
        .with_conn(|conn| {
            Ok(
                conn.query_row("SELECT disabled FROM users WHERE id='user'", [], |row| {
                    row.get::<_, bool>(0)
                })?,
            )
        })
        .unwrap();
    assert!(!disabled);
    let response = fixture
        .request(reqwest::Method::PATCH, "/v1/admin/users/admin", "admin")
        .json(&json!({"role":"user"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anthropic_uses_provider_headers_and_upstream_errors_do_not_expose_secrets() {
    let fixture = Fixture::new().await;
    let provider = Router::new().route(
        "/v1/messages",
        post(
            |headers: axum::http::HeaderMap, Json(body): Json<Value>| async move {
                assert_eq!(headers["x-api-key"], "provider-secret");
                assert_eq!(headers["anthropic-version"], "2023-06-01");
                assert!(headers.get(header::AUTHORIZATION).is_none());
                assert_eq!(body["model"], "real-model");
                assert_eq!(body["system"], "Test context");
                assert_eq!(body["max_tokens"], 512);
                (
                    StatusCode::UNAUTHORIZED,
                    "provider-secret: rejected upstream",
                )
            },
        ),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let mock = tokio::spawn(async move {
        axum::serve(listener, provider).await.unwrap();
    });
    let mut config = settings(&base);
    config["providers"][0]["provider"] = json!("custom_anthropic");
    config["providers"][0]["dialect"] = json!("anthropic");
    assert_eq!(fixture.save(&config).await.status(), StatusCode::OK);
    let body = json!({"system":"Test context","messages":[{"role":"user","content":"hi"}]});
    let response = fixture
        .request(reqwest::Method::POST, "/v1/ai/v1/messages", "user")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let text = response.text().await.unwrap();
    assert!(text.contains("HTTP 401"));
    assert!(!text.contains("provider-secret"));
    assert_eq!(fixture.state.ai.slots.available_permits(), 8);
    mock.abort();
}
