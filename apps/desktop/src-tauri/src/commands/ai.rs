use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

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
    if !["tavily", "brave", "searxng"].contains(&provider.as_str()) {
        return Err("Unknown web search provider.".into());
    }
    let key = if provider == "searxng" { String::new() } else {
        get_ai_api_key(&format!("web-search-{provider}"))
            .map_err(|err| err.to_string())?
            .ok_or_else(|| format!("Add a {provider} search API key in Settings → AI → Web search."))?
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build().map_err(|err| err.to_string())?;
    let request = match provider.as_str() {
        "tavily" => client.post("https://api.tavily.com/search")
            .bearer_auth(&key)
            .json(&json!({ "query": query, "search_depth": "basic", "max_results": 6,
                "include_answer": false, "include_raw_content": false, "auto_parameters": false })),
        "brave" => client.get("https://api.search.brave.com/res/v1/web/search")
            .header("X-Subscription-Token", &key)
            .query(&[("q", query), ("count", "6")]),
        _ => {
            let base = reqwest::Url::parse(base_url.trim()).map_err(|_| "Enter a valid SearXNG URL in Settings → AI → Web search.".to_string())?;
            if !["https", "http"].contains(&base.scheme()) || !base.username().is_empty() || base.password().is_some() {
                return Err("SearXNG URL must use HTTP or HTTPS without embedded credentials.".into());
            }
            client.get(format!("{}/search", base.as_str().trim_end_matches('/')))
                .query(&[("q", query), ("format", "json")])
        }
    };
    let signal = Arc::new(tokio::sync::Notify::new());
    cancels.inner.lock().map_err(|_| "Search cancellation is unavailable".to_string())?
        .insert(request_id.clone(), signal.clone());
    let work = async {
        let response = request.send().await.map_err(|err| format!("Web search failed: {err}"))?;
        let status = response.status();
        if !status.is_success() {
            // Do not expose request headers or provider error bodies containing secrets.
            return Err(format!("Web search returned HTTP {}. Check your search key, provider settings, or quota.", status.as_u16()));
        }
        let parsed: Value = response.json().await.map_err(|_| "Invalid web search response. SearXNG must allow JSON output.".to_string())?;
        parse_web_sources(&provider, &parsed)
    };
    let result = cancellable(&signal, work).await.unwrap_or_else(|| Err("Web search stopped.".into()));
    if let Ok(mut map) = cancels.inner.lock() { map.remove(&request_id); }
    result
}

fn parse_web_sources(provider: &str, parsed: &Value) -> Result<Vec<AiWebSource>, String> {
    let rows = if provider == "brave" { parsed.pointer("/web/results") } else { parsed.get("results") };
    let Some(rows) = rows.and_then(Value::as_array) else {
        if provider == "brave" && parsed.get("query").is_some() { return Ok(Vec::new()); }
        return Err("Search provider returned an invalid result list.".into());
    };
    let mut sources = Vec::<AiWebSource>::new();
    for row in rows {
        let Some(url) = row.get("url").and_then(Value::as_str) else { continue; };
        let Ok(parsed_url) = reqwest::Url::parse(url) else { continue; };
        if !["https", "http"].contains(&parsed_url.scheme()) || !parsed_url.username().is_empty() || parsed_url.password().is_some() {
            continue;
        }
        if sources.iter().any(|source| source.url == url) { continue; }
        sources.push(AiWebSource {
            title: row.get("title").and_then(Value::as_str).unwrap_or(url).chars().take(300).collect(),
            url: url.to_string(),
            snippet: row.get("content").or_else(|| row.get("description"))
                .and_then(Value::as_str).unwrap_or("").chars().take(2400).collect(),
        });
        if sources.len() == 6 { break; }
    }
    Ok(sources)
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
) -> Result<Vec<AiModelInfo>, String> {
    let api_key = if provider_id == "openrouter" {
        String::new() // The model catalog is public; chat still requires a key.
    } else {
        require_key(&provider_id)?
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
pub async fn ai_chat(input: AiChatInput) -> Result<AiChatResult, String> {
    let api_key = require_key(&input.provider_id)?;
    let base = normalize_base_url(&input.base_url);
    validate_chat(&base, &input)?;
    let dialect = input.dialect.to_lowercase();
    match dialect.as_str() {
        "anthropic" => chat_anthropic(&base, &api_key, &input.model, &input.messages).await,
        _ => chat_openai(&base, &api_key, &input.model, &input.messages).await,
    }
}

#[tauri::command]
pub async fn ai_chat_stream(
    request_id: String,
    input: AiChatInput,
    on_event: Channel<AiStreamEvent>,
    cancels: State<'_, AiCancelMap>,
) -> Result<(), String> {
    let api_key = require_key(&input.provider_id)?;
    let base = normalize_base_url(&input.base_url);
    validate_chat(&base, &input)?;

    let cancel = Arc::new(tokio::sync::Notify::new());
    if let Ok(mut map) = cancels.inner.lock() {
        map.insert(request_id.clone(), cancel.clone());
    }

    let dialect = input.dialect.to_lowercase();
    let work = async {
        match dialect.as_str() {
            "anthropic" => {
                stream_anthropic(
                    &on_event,
                    &request_id,
                    &base,
                    &api_key,
                    &input.model,
                    &input.messages,
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
    let response = client
        .post(&url)
        .header("x-api-key", api_key)
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
    let response = client
        .post(&url)
        .header("x-api-key", api_key)
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
