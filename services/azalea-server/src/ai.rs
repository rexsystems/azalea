use std::{collections::HashSet, net::IpAddr, sync::Arc, time::Duration};
use aes_gcm::{aead::{Aead, Payload}, Aes256Gcm, KeyInit, Nonce};
use axum::{body::Body, extract::{DefaultBodyLimit, Path, State}, http::{header, StatusCode}, response::{IntoResponse, Response}, routing::{get, post}, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::StreamExt;
use rand::RngCore;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use crate::{error::{ApiError, ApiResult}, routes::extractors::{AdminUser, AuthUser}, state::AppState};

pub struct AiRuntime {
    key: [u8; 32],
    http: reqwest::Client,
    slots: Arc<Semaphore>,
}

impl AiRuntime {
    pub fn new(jwt_secret: &str) -> anyhow::Result<Self> {
        let key = match std::env::var("AZALEA_AI_ENCRYPTION_KEY") {
            Ok(value) if !value.trim().is_empty() => hex::decode(value.trim())?.try_into().map_err(|_| anyhow::anyhow!("AZALEA_AI_ENCRYPTION_KEY must contain 64 hex characters"))?,
            _ => Sha256::digest(format!("azalea:server-ai:v1:{jwt_secret}")).into(),
        };
        Ok(Self { key, http: reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(180)).build()?, slots: Arc::new(Semaphore::new(8)) })
    }

    fn encrypt(&self, key: &str, scope: &str) -> ApiResult<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).unwrap();
        let mut nonce = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: key.as_bytes(), aad: scope.as_bytes() })
            .map_err(|_| ApiError::Internal(anyhow::anyhow!("AI key encryption failed")))?;
        Ok(format!("v1:{}", STANDARD.encode([nonce.as_slice(), &encrypted].concat())))
    }

    fn decrypt(&self, encrypted: &str, scope: &str) -> ApiResult<String> {
        let fail = || ApiError::Conflict("Server AI key is unreadable. Ask the administrator to save it again.".into());
        let bytes = STANDARD.decode(encrypted.strip_prefix("v1:").ok_or_else(fail)?).map_err(|_| fail())?;
        if bytes.len() < 28 { return Err(fail()); }
        let plain = Aes256Gcm::new_from_slice(&self.key).unwrap().decrypt(Nonce::from_slice(&bytes[..12]), Payload { msg: &bytes[12..], aad: scope.as_bytes() }).map_err(|_| fail())?;
        String::from_utf8(plain).map_err(|_| fail())
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub dialect: String,
    pub base_url: String,
    pub models: Vec<Model>,
    #[serde(default)]
    pub key_configured: bool,
}

#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub enabled: bool,
    pub default_model: String,
    pub requests_per_minute: u32,
    pub max_output_tokens: u32,
    pub providers: Vec<Provider>,
}

#[derive(Deserialize)]
struct ProviderInput {
    #[serde(flatten)]
    config: Provider,
    api_key: Option<String>,
    #[serde(default)]
    clear_key: bool,
}

#[derive(Deserialize)]
struct SettingsInput {
    enabled: bool,
    default_model: String,
    requests_per_minute: u32,
    max_output_tokens: u32,
    providers: Vec<ProviderInput>,
}

struct ProviderRecord {
    config: Provider,
    ciphertext: String,
}

fn scope(provider: &Provider) -> String { format!("{}\n{}\n{}", provider.id, provider.provider, provider.base_url) }
fn model_id(provider: &Provider, model: &Model) -> String { format!("{}::{}", provider.id, model.id) }

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v1/admin/ai", get(admin_settings).put(save_settings))
        .route("/v1/admin/ai/providers/{id}/models", get(provider_models))
        .route("/v1/ai/config", get(client_config))
        .route("/v1/ai/models", get(client_models))
        .route("/v1/ai/chat/completions", post(chat_openai))
        .route("/v1/ai/v1/messages", post(chat_anthropic))
        .layer(DefaultBodyLimit::max(1024 * 1024))
}

fn read_records(state: &AppState) -> ApiResult<Vec<ProviderRecord>> {
    Ok(state.db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT id, name, provider, dialect, base_url, key_ciphertext, models_json FROM ai_providers ORDER BY rowid")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,String>(6)?)))?;
        let mut records = Vec::new();
        for row in rows {
            let (id,name,provider,dialect,base_url,ciphertext,models) = row?;
            records.push(ProviderRecord { config: Provider { id,name,provider,dialect,base_url,key_configured:!ciphertext.is_empty(),models:serde_json::from_str(&models)? }, ciphertext });
        }
        Ok(records)
    })?)
}

fn read_settings(state: &AppState) -> ApiResult<Settings> {
    let (enabled, default_model, requests_per_minute, max_output_tokens) = state.db.with_conn(|conn| Ok(conn.query_row("SELECT enabled, default_model, requests_per_minute, max_output_tokens FROM ai_settings WHERE id=1", [], |r| Ok((r.get::<_,bool>(0)?,r.get::<_,String>(1)?,r.get::<_,u32>(2)?,r.get::<_,u32>(3)?)))?))?;
    Ok(Settings { enabled, default_model, requests_per_minute, max_output_tokens, providers:read_records(state)?.into_iter().map(|record|record.config).collect() })
}

async fn admin_settings(State(state): State<Arc<AppState>>, _admin: AdminUser) -> ApiResult<Json<Settings>> { Ok(Json(read_settings(&state)?)) }

fn validate_provider(provider: &mut Provider) -> ApiResult<()> {
    provider.name = provider.name.trim().to_string();
    provider.base_url = provider.base_url.trim().trim_end_matches('/').to_string();
    if provider.id.len() < 2 || provider.id.len() > 64 || !provider.id.chars().all(|c|c.is_ascii_alphanumeric() || c=='-' || c=='_') || provider.name.is_empty() || provider.name.len()>100 {
        return Err(ApiError::BadRequest("Provider needs a valid ID and name.".into()));
    }
    if !["openai","anthropic","deepseek","groq","openrouter","ollama","amazon_bedrock","amazon_bedrock_mantle","custom_openai","custom_anthropic"].contains(&provider.provider.as_str()) || !["openai","anthropic"].contains(&provider.dialect.as_str()) {
        return Err(ApiError::BadRequest("Unknown provider or API format.".into()));
    }
    let url = reqwest::Url::parse(&provider.base_url).map_err(|_|ApiError::BadRequest("Provider URL is invalid.".into()))?;
    let host = url.host_str().unwrap_or("");
    let private = host == "localhost" || !host.contains('.') || host.ends_with(".local") || host.trim_matches(['[',']']).parse::<IpAddr>().is_ok_and(|ip|match ip { IpAddr::V4(v)=>v.is_private() || v.is_loopback(),IpAddr::V6(v)=>v.is_loopback() || v.is_unique_local() });
    if (url.scheme() != "https" && !(url.scheme()=="http" && private)) || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(ApiError::BadRequest("Use an HTTPS provider URL, or HTTP for a local server, without embedded credentials or query parameters.".into()));
    }
    if provider.models.len() > 1000 { return Err(ApiError::BadRequest("Too many configured models.".into())); }
    let mut ids = HashSet::new();
    for model in &mut provider.models {
        model.id = model.id.trim().to_string();
        model.label = model.label.trim().to_string();
        if model.id.is_empty() || model.id.len()>200 || model.id.chars().any(|c|c.is_control() || c.is_whitespace()) || !ids.insert(model.id.clone()) { return Err(ApiError::BadRequest("Model IDs must be nonempty, unique, and contain no spaces.".into())); }
        if model.label.is_empty() { model.label=model.id.clone(); }
        if model.label.len()>200 { return Err(ApiError::BadRequest("Model label is too long.".into())); }
    }
    Ok(())
}

async fn save_settings(State(state): State<Arc<AppState>>, _admin: AdminUser, Json(mut body): Json<SettingsInput>) -> ApiResult<Json<Settings>> {
    if body.providers.len()>20 || !(1..=120).contains(&body.requests_per_minute) || !(256..=32768).contains(&body.max_output_tokens) { return Err(ApiError::BadRequest("Use at most 20 providers, 1–120 requests/minute and 256–32768 output tokens.".into())); }
    let previous = read_records(&state)?;
    let mut ids = HashSet::new();
    let mut records = Vec::new();
    for input in &mut body.providers {
        validate_provider(&mut input.config)?;
        if !ids.insert(input.config.id.clone()) { return Err(ApiError::BadRequest("Duplicate provider ID.".into())); }
        let old = previous.iter().find(|record|record.config.id==input.config.id);
        let ciphertext = if input.clear_key { String::new() }
            else if let Some(key) = input.api_key.as_ref().map(|v|v.trim()).filter(|v|!v.is_empty()) { state.ai.encrypt(key, &scope(&input.config))? }
            else if let Some(old)=old {
                if !old.ciphertext.is_empty() && (scope(&old.config)!=scope(&input.config) || old.config.dialect!=input.config.dialect) { return Err(ApiError::BadRequest("Save a new key or clear the saved key when changing its provider or endpoint.".into())); }
                old.ciphertext.clone()
            } else { String::new() };
        if body.enabled && !input.config.models.is_empty() && input.config.provider!="ollama" && ciphertext.is_empty() { return Err(ApiError::BadRequest(format!("Save an API key for {} before enabling server AI.",input.config.name))); }
        records.push(ProviderRecord { config:input.config.clone(), ciphertext });
    }
    if body.enabled && !records.iter().any(|record|record.config.models.iter().any(|model|model_id(&record.config,model)==body.default_model)) { return Err(ApiError::BadRequest("Choose a configured model as the server default.".into())); }
    state.db.with_conn(|conn| {
        let tx=conn.unchecked_transaction()?;
        tx.execute("DELETE FROM ai_providers", [])?;
        for record in &records {
            let provider=&record.config;
            tx.execute("INSERT INTO ai_providers(id,name,provider,dialect,base_url,key_ciphertext,models_json) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![provider.id,provider.name,provider.provider,provider.dialect,provider.base_url,record.ciphertext,serde_json::to_string(&provider.models)?])?;
        }
        tx.execute("UPDATE ai_settings SET enabled=?1, default_model=?2, requests_per_minute=?3, max_output_tokens=?4 WHERE id=1",params![body.enabled,body.default_model,body.requests_per_minute,body.max_output_tokens])?;
        tx.commit()?;
        Ok(())
    })?;
    Ok(Json(read_settings(&state)?))
}

fn require_user(state: &AppState, user: &AuthUser) -> ApiResult<()> {
    let enabled = state.db.with_conn(|conn| Ok(conn.query_row("SELECT disabled=0 FROM users WHERE id=?1",params![user.0.sub],|row|row.get::<_,bool>(0)).unwrap_or(false)))?;
    if !enabled { return Err(ApiError::Forbidden("This account cannot use server AI.".into())); }
    Ok(())
}

fn public_config(settings: &Settings) -> Value {
    let models:Vec<Value>=settings.providers.iter().flat_map(|provider|provider.models.iter().map(move |model|json!({"id":model_id(provider,model),"label":format!("{} · {}",provider.name,model.label),"upstream_model":model.id,"dialect":provider.dialect}))).collect();
    json!({"enabled":settings.enabled,"default_model":settings.default_model,"models":if settings.enabled {models} else {Vec::new()}})
}

async fn client_config(State(state): State<Arc<AppState>>, user: AuthUser) -> ApiResult<Json<Value>> { require_user(&state,&user)?; Ok(Json(public_config(&read_settings(&state)?))) }
async fn client_models(State(state): State<Arc<AppState>>, user: AuthUser) -> ApiResult<Json<Value>> {
    require_user(&state,&user)?;
    let settings=read_settings(&state)?;
    if !settings.enabled { return Err(ApiError::Forbidden("Server AI is disabled.".into())); }
    let config=public_config(&settings);
    Ok(Json(json!({"data":config["models"].as_array().unwrap().iter().map(|model|json!({"id":model["id"],"name":model["label"]})).collect::<Vec<_>>()})))
}

async fn provider_models(State(state): State<Arc<AppState>>, _admin: AdminUser, Path(id): Path<String>) -> ApiResult<Json<Vec<Model>>> {
    let records=read_records(&state)?;
    let record=records.iter().find(|record|record.config.id==id).ok_or_else(||ApiError::NotFound("Provider not found. Save the connection first.".into()))?;
    let key=provider_key(&state,record)?;
    let provider=&record.config;
    if provider.provider=="amazon_bedrock" { return Err(ApiError::BadRequest("Bedrock Runtime has no compatible model-list API. Add exact supported IDs.".into())); }
    let base=provider.base_url.trim_end_matches('/');
    let url=if provider.dialect=="anthropic" {format!("{}/v1/models",base.trim_end_matches("/v1"))} else {format!("{base}/models")};
    let mut models=Vec::new();
    let mut cursor=String::new();
    loop {
        let mut request=authorize(state.ai.http.get(&url),provider,&key).timeout(Duration::from_secs(30));
        if provider.dialect=="anthropic" { request=request.query(&[("limit","1000")]); if !cursor.is_empty() { request=request.query(&[("after_id",cursor.as_str())]); } }
        let response=request.send().await.map_err(|_|ApiError::Upstream("Could not connect to the AI provider.".into()))?;
        let status=response.status();
        if !status.is_success() { return Err(ApiError::Upstream(format!("AI provider returned HTTP {} while listing models.",status.as_u16()))); }
        let data:Value=response.json().await.map_err(|_|ApiError::Upstream("Invalid model catalog.".into()))?;
        let rows=data["data"].as_array().ok_or_else(||ApiError::Upstream("Provider returned no model catalog.".into()))?;
        for row in rows {
            if let Some(id)=row["id"].as_str() { models.push(Model {id:id.into(),label:row["display_name"].as_str().or_else(||row["name"].as_str()).unwrap_or(id).into()}); }
        }
        if data["has_more"].as_bool()!=Some(true) || provider.dialect!="anthropic" { break; }
        let next=data["last_id"].as_str().unwrap_or("");
        if next.is_empty() || next==cursor || models.len()>10000 { return Err(ApiError::Upstream("Invalid catalog pagination.".into())); }
        cursor=next.into();
    }
    models.sort_by(|a,b|a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(Json(models))
}

fn provider_key(state: &AppState, record: &ProviderRecord) -> ApiResult<String> {
    if record.config.provider=="ollama" { return Ok("ollama".into()); }
    if record.ciphertext.is_empty() { return Err(ApiError::Conflict("The administrator has not configured this provider's key.".into())); }
    state.ai.decrypt(&record.ciphertext,&scope(&record.config))
}

fn authorize(request: reqwest::RequestBuilder, provider: &Provider, key: &str) -> reqwest::RequestBuilder {
    if provider.dialect=="anthropic" { request.header("x-api-key",key).header("anthropic-version","2023-06-01") }
    else { request.bearer_auth(key) }
}

async fn chat_openai(State(state): State<Arc<AppState>>, user: AuthUser, Json(body): Json<Value>) -> ApiResult<Response> { chat(state,user,body,"openai").await }
async fn chat_anthropic(State(state): State<Arc<AppState>>, user: AuthUser, Json(body): Json<Value>) -> ApiResult<Response> { chat(state,user,body,"anthropic").await }

async fn chat(state: Arc<AppState>, user: AuthUser, body: Value, dialect: &str) -> ApiResult<Response> {
    require_user(&state,&user)?;
    let settings=read_settings(&state)?;
    if !settings.enabled { return Err(ApiError::Forbidden("Server AI is disabled.".into())); }
    let selected=body["model"].as_str().filter(|model|!model.is_empty()).unwrap_or(&settings.default_model);
    let records=read_records(&state)?;
    let (record,model)=records.iter().find_map(|record|record.config.models.iter().find(|model|model_id(&record.config,model)==selected).map(|model|(record,model)))
        .ok_or_else(||ApiError::BadRequest("Choose a model provided by this server.".into()))?;
    if record.config.dialect!=dialect { return Err(ApiError::Conflict("The server's provider format changed. Refresh its models and try again.".into())); }
    let messages=body["messages"].as_array().filter(|messages|!messages.is_empty() && messages.len()<=80).ok_or_else(||ApiError::BadRequest("Send 1–80 text messages.".into()))?;
    let mut bytes=0usize;
    let mut clean=Vec::new();
    for message in messages {
        let role=message["role"].as_str().unwrap_or("");
        let content=message["content"].as_str().ok_or_else(||ApiError::BadRequest("Only text messages are supported.".into()))?;
        if !["system","user","assistant"].contains(&role) { return Err(ApiError::BadRequest("Invalid message role.".into())); }
        bytes+=content.len();
        clean.push(json!({"role":role,"content":content}));
    }
    if bytes>800000 { return Err(ApiError::BadRequest("Conversation is too large. Start a new chat.".into())); }
    let streaming=body["stream"].as_bool().unwrap_or(false);
    let mut upstream=json!({"model":model.id,"messages":clean,"stream":streaming});
    if dialect=="anthropic" {
        if let Some(system)=body["system"].as_str() { if system.len()>200000 { return Err(ApiError::BadRequest("System context is too large.".into())); } upstream["system"]=json!(system); }
    }
    let token_field=if record.config.provider=="openai" {"max_completion_tokens"} else {"max_tokens"};
    upstream[token_field]=json!(settings.max_output_tokens);
    let key=provider_key(&state,record)?;
    let permit=state.ai.slots.clone().try_acquire_owned().map_err(|_|ApiError::TooManyRequests)?;
    let now=chrono::Utc::now().timestamp();
    let allowed=state.db.with_conn(|conn| Ok(conn.execute("INSERT INTO ai_usage(user_id,window_start,requests) VALUES(?1,?2,1) ON CONFLICT(user_id) DO UPDATE SET window_start=CASE WHEN window_start<=?2-60 THEN ?2 ELSE window_start END, requests=CASE WHEN window_start<=?2-60 THEN 1 ELSE requests+1 END WHERE window_start<=?2-60 OR requests<?3",params![user.0.sub,now,settings.requests_per_minute])?>0))?;
    if !allowed { return Err(ApiError::TooManyRequests); }
    let base=record.config.base_url.trim_end_matches('/');
    let url=if dialect=="anthropic" {format!("{}/v1/messages",base.trim_end_matches("/v1"))} else {format!("{base}/chat/completions")};
    let response=authorize(state.ai.http.post(url),&record.config,&key).json(&upstream).send().await.map_err(|_|ApiError::Upstream("Could not connect to the AI provider.".into()))?;
    if !response.status().is_success() { return Err(ApiError::Upstream(format!("AI provider returned HTTP {}. Ask the administrator to check its key, model and limits.",response.status().as_u16()))); }
    let content_type=if streaming {"text/event-stream"} else {"application/json"};
    let stream=futures_util::stream::unfold((response.bytes_stream(),permit),|(mut stream,permit)|async move {
        stream.next().await.map(|chunk|(chunk.map_err(|_|std::io::Error::other("AI stream interrupted")),(stream,permit)))
    });
    Ok((StatusCode::OK,[(header::CONTENT_TYPE,content_type),(header::CACHE_CONTROL,"no-store"),(header::HeaderName::from_static("x-accel-buffering"),"no")],Body::from_stream(stream)).into_response())
}
