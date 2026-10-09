use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::commands::accounts::SharedAccountRegistry;
use crate::store::accounts::AccountKind;
use crate::sync::SharedSyncState;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::keys::{
    ai_api_key_present as key_present, delete_ai_api_key as key_delete, get_ai_api_key,
    store_ai_api_key as key_store,
};

#[derive(Default)]
pub struct AiCancelMap {
    inner: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatInput {
    pub provider_id: String,
    pub dialect: String,
    pub base_url: String,
    pub model: String,
    pub messages: Vec<AiChatMessage>,
}

/// Frontend-pushed AI prefs for the desktop voice worker (localStorage lives in JS).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceAiSnapshot {
    pub enabled: bool,
    pub provider_id: String,
    pub dialect: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Default)]
pub struct SharedVoiceAiConfig(pub Mutex<VoiceAiSnapshot>);

#[tauri::command]
pub fn ai_sync_voice_config(
    config: VoiceAiSnapshot,
    state: State<'_, SharedVoiceAiConfig>,
) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Voice AI config lock poisoned.".to_string())?;
    *guard = config;
    Ok(())
}

/// Blocking helper for the voice recognition thread. Speaks through the caller.
pub fn run_voice_chat(app: &AppHandle, question: &str) -> String {
    let question = question.trim();
    if question.is_empty() {
        return "What would you like to ask?".into();
    }
    let snapshot = match app.try_state::<SharedVoiceAiConfig>() {
        Some(state) => state
            .0
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default(),
        None => VoiceAiSnapshot::default(),
    };
    if !snapshot.enabled {
        let _ = app.emit("azalea-open-settings-ai", ());
        return "AI is off. Open Settings, enable AI, and save a provider key.".into();
    }
    if snapshot.provider_id.trim().is_empty() || snapshot.model.trim().is_empty() {
        let _ = app.emit("azalea-open-settings-ai", ());
        return "Choose a provider and model in Settings → AI first.".into();
    }
    let question = question.chars().take(400).collect::<String>();
    let Some(sync_state) = app.try_state::<SharedSyncState>() else {
        return "AI is unavailable right now.".into();
    };
    let Some(registry_state) = app.try_state::<SharedAccountRegistry>() else {
        return "AI is unavailable right now.".into();
    };
    let sync = sync_state.inner().clone();
    let registry = registry_state.inner().clone();
    let mut input = AiChatInput {
        provider_id: snapshot.provider_id.clone(),
        dialect: snapshot.dialect.clone(),
        base_url: snapshot.base_url.clone(),
        model: snapshot.model.clone(),
        messages: vec![
            AiChatMessage {
                role: "system".into(),
                content: "You are Azalea's spoken assistant. Answer in at most two short sentences. No markdown, lists, or code fences. Plain speech only.".into(),
            },
            AiChatMessage {
                role: "user".into(),
                content: question,
            },
        ],
    };
    let result = tauri::async_runtime::block_on(async {
        let api_key = chat_credentials(&mut input, &sync, &registry).await?;
        let base = normalize_base_url(&input.base_url);
        validate_chat(&base, &input)?;
        let dialect = input.dialect.to_lowercase();
        let answer = match dialect.as_str() {
            "anthropic" => {
                chat_anthropic(
                    &base,
                    &api_key,
                    &input.model,
                    &input.messages,
                    input.provider_id == "selfhost_server",
                )
                .await?
            }
            _ => chat_openai(&base, &api_key, &input.model, &input.messages).await?,
        };
        Ok::<String, String>(answer.content)
    });
    match result {
        Ok(text) => {
            let cleaned = text
                .replace("**", "")
                .replace('`', "")
                .replace('#', "")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if cleaned.is_empty() {
                "I did not get a useful answer.".into()
            } else {
                cleaned.chars().take(400).collect()
            }
        }
        Err(error) => {
            if error.contains("Settings → AI") || error.contains("No API key") {
                let _ = app.emit("azalea-open-settings-ai", ());
            }
            error
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEvent {
    pub request_id: String,
    pub kind: String,
    pub text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelInfo {
    pub id: String,
    pub label: String,
}

async fn selfhost_credentials(
    sync: &SharedSyncState,
    registry: &SharedAccountRegistry,
) -> Result<(String, String, String), String> {
    let account = registry
        .lock()
        .active()
        .cloned()
        .filter(|account| account.kind == AccountKind::Selfhost)
        .ok_or_else(|| {
            "Select and sign in to a self-hosted account to use server AI.".to_string()
        })?;
    let shared = sync.clone();
    let account_id = account.id.clone();
    let (base, token) = tokio::spawn(async move {
        let mut state = shared.lock().await;
        crate::sync::ai_credentials(&mut state, &account_id)
            .await
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|_| "Could not restore the server account session.".to_string())??;
    Ok((base, token, account.id))
}

async fn load_server_config(base: &str, token: &str) -> Result<Value, String> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|err| err.to_string())?
        .get(format!("{base}/config"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Could not reach the self-hosted AI server.".to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|err| err.to_string())?;
    if !status.is_success() {
        return Err(format_http_error(status.as_u16(), &text));
    }
    serde_json::from_str(&text).map_err(|_| "Invalid server AI configuration.".to_string())
}

fn require_active_server_account(
    registry: &SharedAccountRegistry,
    account_id: &str,
) -> Result<(), String> {
    if registry
        .lock()
        .active()
        .is_some_and(|account| account.id == account_id && account.kind == AccountKind::Selfhost)
    {
        Ok(())
    } else {
        Err("Account changed while loading server AI. Try again on the current account.".into())
    }
}

#[tauri::command]
pub async fn ai_server_config(
    sync: State<'_, SharedSyncState>,
    registry: State<'_, SharedAccountRegistry>,
) -> Result<Value, String> {
    let (base, token, account_id) = selfhost_credentials(&sync, &registry).await?;
    let config = load_server_config(&base, &token).await?;
    require_active_server_account(&registry, &account_id)?;
    Ok(
        json!({"accountId":account_id,"enabled":config["enabled"],"defaultModel":config["default_model"],"models":config["models"]}),
    )
}

async fn chat_credentials(
    input: &mut AiChatInput,
    sync: &SharedSyncState,
    registry: &SharedAccountRegistry,
) -> Result<String, String> {
    if input.provider_id != "selfhost_server" {
        return require_key(&input.provider_id);
    }
    let (base, token, account_id) = selfhost_credentials(sync, registry).await?;
    let config = load_server_config(&base, &token).await?;
    require_active_server_account(registry, &account_id)?;
    if config["enabled"].as_bool() != Some(true) {
        return Err("AI is disabled on this server. Ask its administrator to configure it.".into());
    }
    if input.model.trim().is_empty() {
        input.model = config["default_model"].as_str().unwrap_or("").into();
    }
    let model = config["models"]
        .as_array()
        .and_then(|models| {
            models
                .iter()
                .find(|model| model["id"].as_str() == Some(input.model.as_str()))
        })
        .ok_or_else(|| {
            "This model is not provided by the active server. Refresh the server model list."
                .to_string()
        })?;
    input.dialect = model["dialect"].as_str().unwrap_or("openai").into();
    input.base_url = base;
    Ok(token)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWebSource {
    title: String,
    url: String,
    snippet: String,
}

#[tauri::command]
pub async fn ai_web_search(
    request_id: String,
    provider: String,
    query: String,
    base_url: String,
    cancels: State<'_, AiCancelMap>,
) -> Result<Vec<AiWebSource>, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 600 {
        return Err("Search query must contain 1–600 characters.".into());
    }
    if !["mwmbl", "duckduckgo", "tavily", "brave", "searxng"].contains(&provider.as_str()) {
        return Err("Unknown web search provider.".into());
    }
    let key = if ["mwmbl", "searxng", "duckduckgo"].contains(&provider.as_str()) {
        String::new()
    } else {
        get_ai_api_key(&format!("web-search-{provider}"))
            .map_err(|err| err.to_string())?
            .ok_or_else(|| {
                format!("Add a {provider} search API key in Settings → AI → Web search.")
            })?
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|err| err.to_string())?;
    let request = match provider.as_str() {
        "mwmbl" => client
            .get("https://mwmbl.org/api/v2/search/")
            .query(&[("q", query)]),
        "duckduckgo" => client
            .get("https://html.duckduckgo.com/html/")
            .header("User-Agent", "Azalea/0.1 (terminal assistant web search)")
            .query(&[("q", query)]),
        "tavily" => client
            .post("https://api.tavily.com/search")
            .bearer_auth(&key)
            .json(
                &json!({ "query": query, "search_depth": "basic", "max_results": 6,
                "include_answer": false, "include_raw_content": false, "auto_parameters": false }),
            ),
        "brave" => client
            .get("https://api.search.brave.com/res/v1/web/search")
            .header("X-Subscription-Token", &key)
            .query(&[("q", query), ("count", "6")]),
        _ => {
            let base = reqwest::Url::parse(base_url.trim()).map_err(|_| {
                "Enter a valid SearXNG URL in Settings → AI → Web search.".to_string()
            })?;
            if !["https", "http"].contains(&base.scheme())
                || !base.username().is_empty()
                || base.password().is_some()
            {
                return Err(
                    "SearXNG URL must use HTTP or HTTPS without embedded credentials.".into(),
                );
            }
            client
                .get(format!("{}/search", base.as_str().trim_end_matches('/')))
                .query(&[("q", query), ("format", "json")])
        }
    };
    let signal = Arc::new(tokio::sync::Notify::new());
    cancels
        .inner
        .lock()
        .map_err(|_| "Search cancellation is unavailable".to_string())?
        .insert(request_id.clone(), signal.clone());
    let work = async {
        let response = request
            .send()
            .await
            .map_err(|err| format!("Web search failed: {err}"))?;
        let status = response.status();
        if provider == "duckduckgo" && status.as_u16() == 202 {
            return Err("DuckDuckGo requires browser verification. Automated search was stopped; try again later or choose another provider.".into());
        }
        if !status.is_success() {
            // Do not expose request headers or provider error bodies containing secrets.
            return Err(format!(
                "Web search returned HTTP {}. The provider may be unavailable or rate-limited; check Settings → AI → Web search.",
                status.as_u16()
            ));
        }
        if provider == "duckduckgo" {
            let html = response
                .text()
                .await
                .map_err(|err| format!("Could not read search results: {err}"))?;
            return parse_duckduckgo_sources(&html);
        }
        let parsed: Value = response.json().await.map_err(|_| {
            "Invalid web search response. SearXNG must allow JSON output.".to_string()
        })?;
        parse_web_sources(&provider, &parsed)
    };
    let result = cancellable(&signal, work)
        .await
        .unwrap_or_else(|| Err("Web search stopped.".into()));
    if let Ok(mut map) = cancels.inner.lock() {
        map.remove(&request_id);
    }
    result
}

fn parse_web_sources(provider: &str, parsed: &Value) -> Result<Vec<AiWebSource>, String> {
    let rows = if provider == "brave" {
        parsed.pointer("/web/results")
    } else {
        parsed.get("results")
    };
    let Some(rows) = rows.and_then(Value::as_array) else {
        if provider == "brave" && parsed.get("query").is_some() {
            return Ok(Vec::new());
        }
        return Err("Search provider returned an invalid result list.".into());
    };
    let mut sources = Vec::<AiWebSource>::new();
    for row in rows {
        let Some(url) = row.get("url").and_then(Value::as_str) else {
            continue;
        };
        let Ok(parsed_url) = reqwest::Url::parse(url) else {
            continue;
        };
        if !["https", "http"].contains(&parsed_url.scheme())
            || !parsed_url.username().is_empty()
            || parsed_url.password().is_some()
        {
            continue;
        }
        if sources.iter().any(|source| source.url == url) {
            continue;
        }
        sources.push(AiWebSource {
            title: row
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(url)
                .chars()
                .take(300)
                .collect(),
            url: url.to_string(),
            snippet: row
                .get("content")
                .or_else(|| row.get("description"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(2400)
                .collect(),
        });
        if sources.len() == 6 {
            break;
        }
    }
    Ok(sources)
}

fn parse_duckduckgo_sources(html: &str) -> Result<Vec<AiWebSource>, String> {
    use scraper::{Html, Selector};
    let document = Html::parse_document(html);
    let challenge =
        Selector::parse("#challenge-form, .anomaly-modal, form[action*='anomaly.js']").unwrap();
    if document.select(&challenge).next().is_some() {
        return Err("DuckDuckGo requires browser verification. Automated search was stopped; try again later or choose another provider.".into());
    }
    let results = Selector::parse(".result").unwrap();
    let link = Selector::parse(".result__a").unwrap();
    let snippet = Selector::parse(".result__snippet").unwrap();
    let base = reqwest::Url::parse("https://duckduckgo.com").unwrap();
    let mut rows = Vec::new();
    for result in document.select(&results) {
        if result.value().classes().any(|class| class == "result--ad") {
            continue;
        }
        let Some(anchor) = result.select(&link).next() else {
            continue;
        };
        let Some(href) = anchor.value().attr("href") else {
            continue;
        };
        let Ok(mut url) = base.join(href) else {
            continue;
        };
        if url
            .host_str()
            .is_some_and(|host| host == "duckduckgo.com" || host.ends_with(".duckduckgo.com"))
        {
            let Some(target) = url
                .query_pairs()
                .find(|(key, _)| key == "uddg")
                .map(|(_, value)| value.into_owned())
            else {
                continue;
            };
            let Ok(target) = reqwest::Url::parse(&target) else {
                continue;
            };
            url = target;
        }
        let title = anchor.text().collect::<Vec<_>>().join(" ");
        let content = result
            .select(&snippet)
            .next()
            .map(|node| node.text().collect::<Vec<_>>().join(" "))
            .unwrap_or_default();
        rows.push(json!({ "title": title.split_whitespace().collect::<Vec<_>>().join(" "), "url":url.as_str(), "content":content.split_whitespace().collect::<Vec<_>>().join(" ") }));
    }
    if rows.is_empty()
        && document
            .select(&Selector::parse(".no-results, .no-results__message").unwrap())
            .next()
            .is_none()
    {
        return Err("DuckDuckGo did not return readable results. The service may be unavailable or may have changed its response.".into());
    }
    parse_web_sources("duckduckgo", &json!({ "results": rows }))
}

fn normalize_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

#[tauri::command]
pub fn ai_set_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is empty".into());
    }
    key_store(&provider_id, key).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn ai_clear_api_key(provider_id: String) -> Result<(), String> {
    key_delete(&provider_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn ai_api_key_present(provider_id: String) -> Result<bool, String> {
    key_present(&provider_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn ai_chat_cancel(request_id: String, cancels: State<'_, AiCancelMap>) -> Result<(), String> {
    if let Ok(map) = cancels.inner.lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.notify_one();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_list_models(
    provider_id: String,
    base_url: String,
    sync: State<'_, SharedSyncState>,
    registry: State<'_, SharedAccountRegistry>,
) -> Result<Vec<AiModelInfo>, String> {
    let (base_url, api_key) = if provider_id == "selfhost_server" {
        let (base, token, _) = selfhost_credentials(&sync, &registry).await?;
        (base, token)
    } else {
        (
            base_url,
            if provider_id == "openrouter" {
                String::new() // The model catalog is public; chat still requires a key.
            } else {
                require_key(&provider_id)?
            },
        )
    };
    let base = normalize_base_url(&base_url);
    if base.is_empty() {
        return Err("Base URL is empty".into());
    }

    let anthropic = provider_id == "anthropic" || provider_id == "custom_anthropic";
    let url = if anthropic {
        format!("{}/v1/models", base.trim_end_matches("/v1"))
    } else {
        format!("{}/models", base)
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    let mut cursor = String::new();
    loop {
        let mut request = client.get(&url).header("Content-Type", "application/json");
        if anthropic {
            request = request
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .query(&[("limit", "1000")]);
            if !cursor.is_empty() {
                request = request.query(&[("after_id", &cursor)]);
            }
        } else if !api_key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
        let response = request
            .send()
            .await
            .map_err(|err| format!("Request failed: {err}"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| format!("Failed to read response: {err}"))?;
        if !status.is_success() {
            return Err(format_http_error(status.as_u16(), &text));
        }
        let parsed: Value =
            serde_json::from_str(&text).map_err(|err| format!("Invalid JSON response: {err}"))?;
        let arr = parsed
            .get("data")
            .and_then(|d| d.as_array())
            .ok_or_else(|| "Invalid model catalog: missing data array".to_string())?;
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                if provider_id == "openai" && !openai_chat_model(id) {
                    continue;
                }
                let label = item
                    .get("display_name")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .to_string();
                out.push(AiModelInfo {
                    id: id.to_string(),
                    label,
                });
            }
        }
        if !anthropic || parsed.get("has_more").and_then(Value::as_bool) != Some(true) {
            break;
        }
        let next = parsed
            .get("last_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Invalid model catalog pagination".to_string())?;
        if next.is_empty() || next == cursor || out.len() > 10000 {
            return Err("Invalid model catalog pagination".into());
        }
        cursor = next.to_string();
    }
    out.sort_by(|a, b| a.label.to_lowercase().cmp(&b.label.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn ai_chat(
    mut input: AiChatInput,
    sync: State<'_, SharedSyncState>,
    registry: State<'_, SharedAccountRegistry>,
) -> Result<AiChatResult, String> {
    let api_key = chat_credentials(&mut input, &sync, &registry).await?;
    let base = normalize_base_url(&input.base_url);
    validate_chat(&base, &input)?;
    let dialect = input.dialect.to_lowercase();
    match dialect.as_str() {
        "anthropic" => {
            chat_anthropic(
                &base,
                &api_key,
                &input.model,
                &input.messages,
                input.provider_id == "selfhost_server",
            )
            .await
        }
        _ => chat_openai(&base, &api_key, &input.model, &input.messages).await,
    }
}

#[tauri::command]
pub async fn ai_chat_stream(
    request_id: String,
    mut input: AiChatInput,
    on_event: Channel<AiStreamEvent>,
    cancels: State<'_, AiCancelMap>,
    sync: State<'_, SharedSyncState>,
    registry: State<'_, SharedAccountRegistry>,
) -> Result<(), String> {
    let cancel = Arc::new(tokio::sync::Notify::new());
    if let Ok(mut map) = cancels.inner.lock() {
        map.insert(request_id.clone(), cancel.clone());
    }

    let work = async {
        let api_key = chat_credentials(&mut input, &sync, &registry).await?;
        let base = normalize_base_url(&input.base_url);
        validate_chat(&base, &input)?;
        let dialect = input.dialect.to_lowercase();
        match dialect.as_str() {
            "anthropic" => {
                stream_anthropic(
                    &on_event,
                    &request_id,
                    &base,
                    &api_key,
                    &input.model,
                    &input.messages,
                    input.provider_id == "selfhost_server",
                )
                .await
            }
            _ => {
                stream_openai(
                    &on_event,
                    &request_id,
                    &base,
                    &api_key,
                    &input.model,
                    &input.messages,
                )
                .await
            }
        }
    };
    let result = match cancellable(&cancel, work).await {
        Some(result) => result,
        None => {
            emit_stream(&on_event, &request_id, "done", None);
            Ok(())
        }
    };

    if let Ok(mut map) = cancels.inner.lock() {
        map.remove(&request_id);
    }

    result
}

fn require_key(provider_id: &str) -> Result<String, String> {
    if provider_id == "ollama" {
        return Ok("ollama".to_string());
    }
    get_ai_api_key(provider_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No API key saved for this provider. Add one in Settings → AI.".to_string())
}

async fn cancellable<T>(
    cancel: &tokio::sync::Notify,
    work: impl std::future::Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        biased;
        _ = cancel.notified() => None,
        result = work => Some(result),
    }
}

fn openai_chat_model(id: &str) -> bool {
    let text_model = id.starts_with("gpt-")
        || id.starts_with("chatgpt-")
        || (id.starts_with('o') && id.as_bytes().get(1).is_some_and(u8::is_ascii_digit));
    text_model
        && ![
            "image",
            "audio",
            "realtime",
            "transcribe",
            "tts",
            "codex",
            "-pro",
        ]
        .iter()
        .any(|kind| id.contains(kind))
}

fn validate_chat(base: &str, input: &AiChatInput) -> Result<(), String> {
    if base.is_empty() {
        return Err("Base URL is empty".into());
    }
    if input.model.trim().is_empty() {
        return Err("Model is empty".into());
    }
    if input.messages.is_empty() {
        return Err("No messages".into());
    }
    Ok(())
}

fn emit_stream(
    on_event: &Channel<AiStreamEvent>,
    request_id: &str,
    kind: &str,
    text: Option<String>,
) {
    let _ = on_event.send(AiStreamEvent {
        request_id: request_id.to_string(),
        kind: kind.to_string(),
        text,
    });
}

#[derive(Default)]
struct SseLines {
    buffer: Vec<u8>,
}

impl SseLines {
    fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let raw: Vec<u8> = self.buffer.drain(..=index).collect();
            lines.push(
                String::from_utf8_lossy(&raw)
                    .trim_end_matches(['\r', '\n'])
                    .to_string(),
            );
        }
        lines
    }
}

async fn chat_openai(
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
) -> Result<AiChatResult, String> {
    let url = format!("{}/chat/completions", base);
    let body = json!({
        "model": model,
        "messages": messages.iter().map(|m| json!({
            "role": m.role,
            "content": m.content,
        })).collect::<Vec<_>>(),
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response: {err}"))?;
    if !status.is_success() {
        return Err(format_http_error(status.as_u16(), &text));
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|err| format!("Invalid JSON response: {err}"))?;
    let content = parsed
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Provider response missing message content".to_string())?;
    Ok(AiChatResult { content })
}

async fn stream_openai(
    on_event: &Channel<AiStreamEvent>,
    request_id: &str,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
) -> Result<(), String> {
    let url = format!("{}/chat/completions", base);
    let body = json!({
        "model": model,
        "stream": true,
        "messages": messages.iter().map(|m| json!({
            "role": m.role,
            "content": m.content,
        })).collect::<Vec<_>>(),
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("Request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let err = format_http_error(status.as_u16(), &text);
        emit_stream(on_event, request_id, "error", Some(err.clone()));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut lines = SseLines::default();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|err| format!("Stream error: {err}"))?;
        for line in lines.push(&bytes) {
            if !line.starts_with("data:") {
                continue;
            }
            let data = line[5..].trim();
            if data == "[DONE]" {
                emit_stream(on_event, request_id, "done", None);
                return Ok(());
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(delta) = parsed
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str())
                {
                    if !delta.is_empty() {
                        emit_stream(on_event, request_id, "delta", Some(delta.to_string()));
                    }
                }
            }
        }
    }
    emit_stream(on_event, request_id, "done", None);
    Ok(())
}

async fn chat_anthropic(
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
    bearer: bool,
) -> Result<AiChatResult, String> {
    let (system, api_messages) = split_anthropic_messages(messages)?;
    let url = format!("{}/v1/messages", base.trim_end_matches("/v1"));
    let mut body = json!({
        "model": model,
        "max_tokens": 4096,
        "messages": api_messages,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }

    let client = reqwest::Client::new();
    let request = client.post(&url);
    let response = (if bearer {
        request.bearer_auth(api_key)
    } else {
        request.header("x-api-key", api_key)
    })
    .header("anthropic-version", "2023-06-01")
    .header("Content-Type", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(|err| format!("Request failed: {err}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response: {err}"))?;
    if !status.is_success() {
        return Err(format_http_error(status.as_u16(), &text));
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|err| format!("Invalid JSON response: {err}"))?;
    let content = extract_anthropic_text(&parsed)
        .ok_or_else(|| "Provider response missing text content".to_string())?;
    Ok(AiChatResult { content })
}

async fn stream_anthropic(
    on_event: &Channel<AiStreamEvent>,
    request_id: &str,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
    bearer: bool,
) -> Result<(), String> {
    let (system, api_messages) = split_anthropic_messages(messages)?;
    let url = format!("{}/v1/messages", base.trim_end_matches("/v1"));
    let mut body = json!({
        "model": model,
        "max_tokens": 4096,
        "stream": true,
        "messages": api_messages,
    });
    if !system.is_empty() {
        body["system"] = json!(system);
    }

    let client = reqwest::Client::new();
    let request = client.post(&url);
    let response = (if bearer {
        request.bearer_auth(api_key)
    } else {
        request.header("x-api-key", api_key)
    })
    .header("anthropic-version", "2023-06-01")
    .header("Content-Type", "application/json")
    .header("Accept", "text/event-stream")
    .json(&body)
    .send()
    .await
    .map_err(|err| format!("Request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let err = format_http_error(status.as_u16(), &text);
        emit_stream(on_event, request_id, "error", Some(err.clone()));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut lines = SseLines::default();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|err| format!("Stream error: {err}"))?;
        for line in lines.push(&bytes) {
            if !line.starts_with("data:") {
                continue;
            }
            let data = line[5..].trim();
            if data.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if event_type == "content_block_delta" {
                    if let Some(delta) = parsed.pointer("/delta/text").and_then(|v| v.as_str()) {
                        if !delta.is_empty() {
                            emit_stream(on_event, request_id, "delta", Some(delta.to_string()));
                        }
                    }
                } else if event_type == "message_stop" {
                    emit_stream(on_event, request_id, "done", None);
                    return Ok(());
                } else if event_type == "error" {
                    let msg = parsed
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Anthropic stream error")
                        .to_string();
                    emit_stream(on_event, request_id, "error", Some(msg.clone()));
                    return Err(msg);
                }
            }
        }
    }
    emit_stream(on_event, request_id, "done", None);
    Ok(())
}

fn split_anthropic_messages(messages: &[AiChatMessage]) -> Result<(String, Vec<Value>), String> {
    let mut system = String::new();
    let mut api_messages: Vec<Value> = Vec::new();
    for message in messages {
        let role = message.role.to_lowercase();
        if role == "system" {
            if !system.is_empty() {
                system.push('\n');
            }
            system.push_str(&message.content);
            continue;
        }
        let mapped = if role == "assistant" {
            "assistant"
        } else {
            "user"
        };
        api_messages.push(json!({
            "role": mapped,
            "content": message.content,
        }));
    }
    if api_messages.is_empty() {
        return Err("No user/assistant messages to send".into());
    }
    Ok((system, api_messages))
}

fn extract_anthropic_text(parsed: &Value) -> Option<String> {
    let blocks = parsed.get("content")?.as_array()?;
    let mut out = String::new();
    for block in blocks {
        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(text);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn format_http_error(status: u16, body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return format!("Provider returned HTTP {status}");
    }
    let snippet: String = trimmed.chars().take(400).collect();
    format!("Provider returned HTTP {status}: {snippet}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_results_normalize_providers_and_reject_unsafe_urls() {
        for provider in ["mwmbl", "tavily", "searxng", "brave"] {
            let rows = json!([
                {"title":"Docs", "url":"https://example.com/docs", "content":"Excerpt", "description":"Brave excerpt"},
                {"title":"Duplicate", "url":"https://example.com/docs"},
                {"url":"javascript:alert(1)"}, {"url":"file:///etc/passwd"},
                {"url":"https://user:password@example.com"}
            ]);
            let response = if provider == "brave" {
                json!({"web":{"results": rows}})
            } else {
                json!({"results":rows})
            };
            let sources = parse_web_sources(provider, &response).unwrap();
            assert_eq!(sources.len(), 1);
            assert_eq!(sources[0].title, "Docs");
            assert_eq!(sources[0].url, "https://example.com/docs");
            assert_eq!(sources[0].snippet, "Excerpt");
        }
    }

    #[test]
    fn search_result_count_and_excerpts_are_bounded() {
        let rows: Vec<Value> = (0..30)
            .map(|i| json!({"url":format!("https://example.com/{i}"), "content":"x".repeat(10000)}))
            .collect();
        let sources = parse_web_sources("tavily", &json!({"results":rows})).unwrap();
        assert_eq!(sources.len(), 6);
        assert_eq!(sources[0].snippet.len(), 2400);
        assert!(parse_web_sources("tavily", &json!({"error":"bad"})).is_err());
        assert!(
            parse_web_sources("brave", &json!({"query":{"original":"no matches"}}))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn keyless_html_search_decodes_sources_and_rejects_challenges() {
        let html = r#"<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftauri.app%2F">Tauri &amp; Docs</a><a class="result__snippet">Build <b>apps</b> safely.</a></div>
            <div class="result result--ad"><a class="result__a" href="https://ad.example.com">Ad</a></div>
            <div class="result"><a class="result__a" href="javascript:alert(1)">Unsafe</a></div>"#;
        let sources = parse_duckduckgo_sources(html).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://tauri.app/");
        assert_eq!(sources[0].title, "Tauri & Docs");
        assert_eq!(sources[0].snippet, "Build apps safely.");
        assert!(parse_duckduckgo_sources("<form id='challenge-form'></form>").is_err());
        assert!(parse_duckduckgo_sources("<p>Unavailable</p>").is_err());
        assert!(
            parse_duckduckgo_sources("<div class='no-results'>No matches</div>")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn openai_catalog_omits_models_for_other_api_types() {
        for id in [
            "gpt-5-mini",
            "gpt-4.1",
            "o3",
            "o4-mini",
            "gpt-5-chat-latest",
        ] {
            assert!(openai_chat_model(id));
        }
        for id in [
            "gpt-image-1",
            "whisper-1",
            "gpt-4o-realtime-preview",
            "gpt-audio",
            "text-embedding-3-small",
            "gpt-5-codex",
            "o3-pro",
        ] {
            assert!(!openai_chat_model(id));
        }
    }

    #[test]
    fn sse_preserves_unicode_across_every_byte_boundary() {
        let text = "data: {\"text\":\"așteaptă 🪻\"}\r\n\ndata: done\n";
        for boundary in 0..text.len() {
            let mut parser = SseLines::default();
            let mut lines = parser.push(&text.as_bytes()[..boundary]);
            lines.extend(parser.push(&text.as_bytes()[boundary..]));
            assert_eq!(
                lines,
                vec!["data: {\"text\":\"așteaptă 🪻\"}", "", "data: done"]
            );
        }
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_silent_request() {
        let signal = Arc::new(tokio::sync::Notify::new());
        let other = signal.clone();
        let request =
            tokio::spawn(async move { cancellable(&other, std::future::pending::<()>()).await });
        signal.notify_one();
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), request).await;
        assert!(result.unwrap().unwrap().is_none());
    }

    #[tokio::test]
    async fn cancellation_before_request_start_is_retained() {
        let signal = tokio::sync::Notify::new();
        signal.notify_one();
        assert!(cancellable(&signal, std::future::pending::<()>())
            .await
            .is_none());
        assert_eq!(cancellable(&signal, async { 42 }).await, Some(42));
    }
}
