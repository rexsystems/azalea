use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::keys::{
    ai_api_key_present as key_present, delete_ai_api_key as key_delete, get_ai_api_key,
    store_ai_api_key as key_store,
};

#[derive(Default)]
pub struct AiCancelMap {
    inner: Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>,
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
pub fn ai_chat_cancel(
    request_id: String,
    cancels: State<'_, AiCancelMap>,
) -> Result<(), String> {
    if let Ok(map) = cancels.inner.lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_list_models(
    provider_id: String,
    base_url: String,
) -> Result<Vec<AiModelInfo>, String> {
    let api_key = get_ai_api_key(&provider_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No API key saved for this provider.".to_string())?;
    let base = normalize_base_url(&base_url);
    if base.is_empty() {
        return Err("Base URL is empty".into());
    }

    let url = format!("{}/models", base);
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
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
    let mut out = Vec::new();
    if let Some(arr) = parsed.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let label = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(id)
                    .to_string();
                out.push(AiModelInfo {
                    id: id.to_string(),
                    label,
                });
            }
        }
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
    app: AppHandle,
    request_id: String,
    input: AiChatInput,
    cancels: State<'_, AiCancelMap>,
) -> Result<(), String> {
    let api_key = require_key(&input.provider_id)?;
    let base = normalize_base_url(&input.base_url);
    validate_chat(&base, &input)?;

    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut map) = cancels.inner.lock() {
        map.insert(request_id.clone(), cancel.clone());
    }

    let dialect = input.dialect.to_lowercase();
    let result = match dialect.as_str() {
        "anthropic" => {
            stream_anthropic(
                &app,
                &request_id,
                &base,
                &api_key,
                &input.model,
                &input.messages,
                cancel.clone(),
            )
            .await
        }
        _ => {
            stream_openai(
                &app,
                &request_id,
                &base,
                &api_key,
                &input.model,
                &input.messages,
                cancel.clone(),
            )
            .await
        }
    };

    if let Ok(mut map) = cancels.inner.lock() {
        map.remove(&request_id);
    }

    result
}

fn require_key(provider_id: &str) -> Result<String, String> {
    get_ai_api_key(provider_id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No API key saved for this provider. Add one in Settings → AI.".to_string())
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

fn emit_stream(app: &AppHandle, request_id: &str, kind: &str, text: Option<String>) {
    let _ = app.emit(
        "ai-stream",
        AiStreamEvent {
            request_id: request_id.to_string(),
            kind: kind.to_string(),
            text,
        },
    );
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
        "temperature": 0.3,
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
    app: &AppHandle,
    request_id: &str,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
    cancel: Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", base);
    let body = json!({
        "model": model,
        "stream": true,
        "messages": messages.iter().map(|m| json!({
            "role": m.role,
            "content": m.content,
        })).collect::<Vec<_>>(),
        "temperature": 0.3,
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
        emit_stream(app, request_id, "error", Some(err.clone()));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            emit_stream(app, request_id, "done", None);
            return Ok(());
        }
        let bytes = chunk.map_err(|err| format!("Stream error: {err}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer = buffer[idx + 1..].to_string();
            if !line.starts_with("data:") {
                continue;
            }
            let data = line[5..].trim();
            if data == "[DONE]" {
                emit_stream(app, request_id, "done", None);
                return Ok(());
            }
            if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(delta) = parsed
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str())
                {
                    if !delta.is_empty() {
                        emit_stream(app, request_id, "delta", Some(delta.to_string()));
                    }
                }
            }
        }
    }
    emit_stream(app, request_id, "done", None);
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
    app: &AppHandle,
    request_id: &str,
    base: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatMessage],
    cancel: Arc<std::sync::atomic::AtomicBool>,
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
        emit_stream(app, request_id, "error", Some(err.clone()));
        return Err(err);
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            emit_stream(app, request_id, "done", None);
            return Ok(());
        }
        let bytes = chunk.map_err(|err| format!("Stream error: {err}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(idx) = buffer.find('\n') {
            let line = buffer[..idx].trim_end_matches('\r').to_string();
            buffer = buffer[idx + 1..].to_string();
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
                    if let Some(delta) = parsed
                        .pointer("/delta/text")
                        .and_then(|v| v.as_str())
                    {
                        if !delta.is_empty() {
                            emit_stream(app, request_id, "delta", Some(delta.to_string()));
                        }
                    }
                } else if event_type == "message_stop" {
                    emit_stream(app, request_id, "done", None);
                    return Ok(());
                } else if event_type == "error" {
                    let msg = parsed
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Anthropic stream error")
                        .to_string();
                    emit_stream(app, request_id, "error", Some(msg.clone()));
                    return Err(msg);
                }
            }
        }
    }
    emit_stream(app, request_id, "done", None);
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
        let mapped = if role == "assistant" { "assistant" } else { "user" };
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
