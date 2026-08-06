use futures_util::StreamExt;
use keyring::Entry;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

const DEEPSEEK_URL: &str = "https://api.deepseek.com/chat/completions";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-chat";
const PROVIDER_KEY_SERVICE: &str = "com.meridian.providers";

#[tauri::command]
async fn browser_open_login(app: AppHandle, provider: String, url: String) -> Result<String, String> {
    let safe = provider.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect::<String>();
    if safe.is_empty() || !(url.starts_with("https://")) { return Err("Invalid browser provider or URL".into()); }
    let profile = app.path().app_data_dir().map_err(|e| e.to_string())?.join("browser-profiles").join(safe);
    fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            std::env::var("PROGRAMFILES").unwrap_or_default() + "\\Google\\Chrome\\Application\\chrome.exe",
            std::env::var("LOCALAPPDATA").unwrap_or_default() + "\\Google\\Chrome\\Application\\chrome.exe",
            std::env::var("PROGRAMFILES").unwrap_or_default() + "\\Microsoft\\Edge\\Application\\msedge.exe",
        ];
        let browser = candidates.iter().find(|path| Path::new(path).exists()).ok_or("Chrome or Edge was not found")?;
        Command::new(browser).arg(format!("--user-data-dir={}", profile.to_string_lossy())).arg("--no-first-run").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    { Command::new("google-chrome").arg(format!("--user-data-dir={}", profile.to_string_lossy())).arg("--no-first-run").arg(url).spawn().map_err(|e| e.to_string())?; }
    Ok(profile.to_string_lossy().into_owned())
}

fn provider_env_name(provider: &str) -> Result<&'static str, String> {
    match provider {
        "openai" => Ok("OPENAI_API_KEY"),
        "anthropic" => Ok("ANTHROPIC_API_KEY"),
        "google" => Ok("GEMINI_API_KEY"),
        "openrouter" => Ok("OPENROUTER_API_KEY"),
        "deepseek" => Ok("DEEPSEEK_API_KEY"),
        _ => Err("Unsupported provider".to_string()),
    }
}

fn provider_key(provider: &str) -> Result<String, String> {
    let env_name = provider_env_name(provider)?;
    if let Ok(entry) = Entry::new(PROVIDER_KEY_SERVICE, provider) {
        if let Ok(key) = entry.get_password() {
            if !key.trim().is_empty() { return Ok(key); }
        }
    }
    std::env::var(env_name).map_err(|_| format!("{} is not configured.", env_name))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConnection { provider: String, connected: bool }

#[tauri::command]
fn save_provider_key(provider: String, api_key: String) -> Result<(), String> {
    if api_key.trim().len() < 8 { return Err("API key appears incomplete.".to_string()); }
    provider_env_name(&provider)?;
    Entry::new(PROVIDER_KEY_SERVICE, &provider)
        .map_err(|_| "Could not access Windows Credential Manager.".to_string())?
        .set_password(api_key.trim())
        .map_err(|_| "Could not save the API key.".to_string())
}

#[tauri::command]
fn provider_connections() -> Vec<ProviderConnection> {
    ["openai", "anthropic", "google", "openrouter", "deepseek"].iter().map(|provider| {
        let connected = provider_key(provider).is_ok();
        ProviderConnection { provider: (*provider).to_string(), connected }
    }).collect()
}

fn deepseek_api_key() -> Result<String, String> {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");
    let _ = dotenvy::from_path(env_path);
    provider_key("deepseek")
        .map_err(|_| "DEEPSEEK_API_KEY is not configured. Add an official DeepSeek API key in Settings.".to_string())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModel {
    id: String,
    name: String,
    provider: String,
    access: String,
    tag: String,
    context_window: Option<u64>,
    input_cost_usd_per_million: Option<f64>,
    output_cost_usd_per_million: Option<f64>,
}

fn model_tag(id: &str) -> String {
    let value = id.to_ascii_lowercase();
    if value.contains("reason") || value.contains("r1") || value.contains("o3") || value.contains("thinking") { return "reasoning".into(); }
    if value.contains("mini") || value.contains("nano") || value.contains("flash") || value.contains("lite") { return "fast".into(); }
    if value.contains("pro") || value.contains("opus") || value.contains("gpt-5") || value.contains("sonnet") { return "flagship".into(); }
    "standard".into()
}

fn catalog_model(provider: &str, id: String, name: String, access: &str) -> ProviderModel {
    let tag = model_tag(&id);
    ProviderModel { id: format!("{}:{}", provider, id), name, provider: provider.into(), access: access.into(), tag, context_window: None, input_cost_usd_per_million: None, output_cost_usd_per_million: None }
}

async fn fetch_openai_compatible_models(client: &reqwest::Client, provider: &str, url: &str, api_key: String, access: &str) -> Result<Vec<ProviderModel>, String> {
    let response = client.get(url).bearer_auth(api_key).send().await.map_err(|_| format!("{} model catalog could not be reached", provider))?;
    if !response.status().is_success() { return Err(format!("{} model catalog request was rejected", provider)); }
    let value: serde_json::Value = response.json().await.map_err(|_| format!("{} returned an invalid model catalog", provider))?;
    Ok(value.get("data").and_then(|v| v.as_array()).into_iter().flatten().filter_map(|item| {
        let id = item.get("id")?.as_str()?.to_string();
        let normalized = id.to_ascii_lowercase();
        if ["deep-research", "research-preview", "embedding", "moderation", "audio", "transcribe", "tts", "realtime", "image", "computer-use"].iter().any(|term| normalized.contains(term)) { return None; }
        let mut model = catalog_model(provider, id.clone(), item.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string(), access);
        model.context_window = item.get("context_length").and_then(|v| v.as_u64());
        model.input_cost_usd_per_million = item.get("pricing").and_then(|v| v.get("prompt")).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).map(|v| v * 1_000_000.0);
        model.output_cost_usd_per_million = item.get("pricing").and_then(|v| v.get("completion")).and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok()).map(|v| v * 1_000_000.0);
        Some(model)
    }).collect())
}

#[tauri::command]
async fn provider_models() -> Result<Vec<ProviderModel>, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build().map_err(|_| "Could not initialize the provider catalog client".to_string())?;
    let mut models = Vec::new();
    if let Ok(key) = provider_key("openai") {
        if let Ok(mut items) = fetch_openai_compatible_models(&client, "openai", "https://api.openai.com/v1/models", key, "Paid").await { models.append(&mut items); }
    }
    if let Ok(key) = provider_key("openrouter") {
        if let Ok(mut items) = fetch_openai_compatible_models(&client, "openrouter", "https://openrouter.ai/api/v1/models", key, "Free & Paid").await { models.append(&mut items); }
    }
    if let Ok(key) = provider_key("google") {
        let response = client.get("https://generativelanguage.googleapis.com/v1beta/models").query(&[("key", key)]).send().await;
        if let Ok(response) = response {
            if response.status().is_success() {
                if let Ok(value) = response.json::<serde_json::Value>().await {
                    if let Some(items) = value.get("models").and_then(|v| v.as_array()) {
                        models.extend(items.iter().filter(|item| item.get("supportedGenerationMethods").and_then(|v| v.as_array()).map(|methods| methods.iter().any(|method| method.as_str() == Some("generateContent"))).unwrap_or(true)).filter_map(|item| {
                            let raw = item.get("name")?.as_str()?.trim_start_matches("models/").to_string();
                            let mut model = catalog_model("google", raw.clone(), item.get("displayName").and_then(|v| v.as_str()).unwrap_or(&raw).to_string(), "Free & Paid");
                            model.context_window = item.get("inputTokenLimit").and_then(|v| v.as_u64());
                            Some(model)
                        }));
                    }
                }
            }
        }
    }
    if provider_key("anthropic").is_ok() {
        for (id, name) in [("claude-opus-4-6", "Claude Opus 4.6"), ("claude-sonnet-4-5", "Claude Sonnet 4.5"), ("claude-haiku-4-5", "Claude Haiku 4.5")] {
            models.push(catalog_model("anthropic", id.into(), name.into(), "Paid"));
        }
    }
    if provider_key("deepseek").is_ok() {
        for (id, name) in [("deepseek-chat", "DeepSeek V3"), ("deepseek-reasoner", "DeepSeek R1")] {
            models.push(catalog_model("deepseek", id.into(), name.into(), "Paid"));
        }
    }
    models.sort_by(|a, b| a.provider.cmp(&b.provider).then(a.name.cmp(&b.name)));
    models.dedup_by(|a, b| a.id == b.id);
    Ok(models)
}


#[derive(Clone, Serialize)]
struct ChunkPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    delta: String,
}

#[derive(Clone, Serialize)]
struct DonePayload {
    #[serde(rename = "requestId")]
    request_id: String,
    full: String,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    error: String,
}

fn emit_delta(app: &AppHandle, request_id: &str, delta: &str) {
    let _ = app.emit(
        "chat-chunk",
        ChunkPayload {
            request_id: request_id.to_string(),
            delta: delta.to_string(),
        },
    );
}


#[tauri::command]
async fn chat_stream(
    app: AppHandle,
    request_id: String,
    message: String,
    model: Option<String>,
) -> Result<(), String> {
    let requested_model = model.as_deref().unwrap_or(DEFAULT_DEEPSEEK_MODEL);
    let (provider, model_type) = requested_model.split_once(':').unwrap_or_else(|| {
        let inferred = if requested_model.starts_with("gemini") || requested_model.starts_with("gemma") {
            "google"
        } else if requested_model.starts_with("claude") {
            "anthropic"
        } else if requested_model.starts_with("gpt") || requested_model.starts_with("o") {
            "openai"
        } else if requested_model.starts_with("deepseek") {
            "deepseek"
        } else {
            ""
        };
        (inferred, requested_model)
    });
    if provider.is_empty() {
        return Err(format!("The selected model '{}' has no provider. Select a model again in the picker.", requested_model));
    }
    let (endpoint, api_key) = match provider {
        "deepseek" => (DEEPSEEK_URL, deepseek_api_key()?),
        "openai" => ("https://api.openai.com/v1/chat/completions", provider_key("openai")?),
        "openrouter" => ("https://openrouter.ai/api/v1/chat/completions", provider_key("openrouter")?),
        "google" => ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", provider_key("google")?),
        "anthropic" => ("https://api.anthropic.com/v1/messages", provider_key("anthropic")?),
        _ => return Err("The selected model provider is not supported.".to_string()),
    };
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Client build error: {}", e))?;

    let body = if provider == "anthropic" {
        serde_json::json!({ "model": model_type, "max_tokens": 4096, "messages": [{ "role": "user", "content": message }], "stream": true })
    } else {
        serde_json::json!({ "model": model_type, "messages": [{ "role": "user", "content": message }], "stream": true })
    };

    let request = client.post(endpoint).header("Content-Type", "application/json").header("Accept", "text/event-stream");
    let request = if provider == "anthropic" { request.header("x-api-key", api_key).header("anthropic-version", "2023-06-01") } else { request.bearer_auth(api_key) };
    let res = match request.json(&body).send().await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status();
            let body_text = r.text().await.unwrap_or_default();
            let err = format!(
                "DeepSeek API error {}: {}",
                status,
                &body_text[..body_text.len().min(500)]
            );
            let _ = app.emit(
                "chat-error",
                ErrorPayload {
                    request_id: request_id.clone(),
                    error: err.clone(),
                },
            );
            return Err(err);
        }
        Err(e) => {
            let err = format!("DeepSeek request failed: {}", e);
            let _ = app.emit(
                "chat-error",
                ErrorPayload {
                    request_id: request_id.clone(),
                    error: err.clone(),
                },
            );
            return Err(err);
        }
    };

    let mut stream = res.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    loop {
        let chunk = match tokio::time::timeout(
            std::time::Duration::from_secs(90),
            stream.next(),
        )
        .await
        {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(_) => {
                let err = "DeepSeek stream stalled for 90s".to_string();
                let _ = app.emit(
                    "chat-error",
                    ErrorPayload {
                        request_id: request_id.clone(),
                        error: err.clone(),
                    },
                );
                return Err(err);
            }
        };

        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                let err = format!("DeepSeek stream error: {}", e);
                let _ = app.emit(
                    "chat-error",
                    ErrorPayload {
                        request_id: request_id.clone(),
                        error: err.clone(),
                    },
                );
                return Err(err);
            }
        };

        buffer.push_str(&String::from_utf8_lossy(&bytes));

        loop {
            let line_end = match buffer.find('\n') {
                Some(i) => i,
                None => break,
            };

            let line = buffer[..line_end].trim().to_string();
            buffer.drain(..=line_end);

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            let json_str = match line.strip_prefix("data:") {
                Some(value) => value.trim(),
                None => continue,
            };

            if json_str == "[DONE]" || json_str.is_empty() {
                continue;
            }

            let val = match serde_json::from_str::<serde_json::Value>(json_str) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if let Some(error) = val.get("error") {
                let err = error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("DeepSeek returned an unknown error")
                    .to_string();
                let _ = app.emit(
                    "chat-error",
                    ErrorPayload {
                        request_id: request_id.clone(),
                        error: err.clone(),
                    },
                );
                return Err(err);
            }

            let delta = val
                .get("choices")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("delta"))
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_str())
                .or_else(|| val.get("delta").and_then(|v| v.get("text")).and_then(|v| v.as_str()));
            if let Some(delta) = delta {
                if !delta.is_empty() {
                    full_text.push_str(delta);
                    emit_delta(&app, &request_id, delta);
                }
            }
        }
    }

    let _ = app.emit(
        "chat-done",
        DonePayload {
            request_id: request_id.clone(),
            full: full_text,
        },
    );

    Ok(())
}

#[derive(serde::Deserialize)]
struct VisionImage {
    #[serde(rename = "mimeType")]
    mime_type: String,
    content: String,
}

#[tauri::command]
async fn chat_stream_vision(
    app: AppHandle,
    request_id: String,
    message: String,
    images: Vec<VisionImage>,
    model: Option<String>,
) -> Result<(), String> {
    let requested = model.as_deref().unwrap_or("google:gemini-2.0-flash");
    let model_name = requested.strip_prefix("google:").unwrap_or(requested);
    if !model_name.starts_with("gemini") && !model_name.starts_with("gemma") {
        return Err("Image input is currently supported for Gemini models only.".to_string());
    }
    let key = provider_key("google")?;
    let endpoint = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}", model_name, key);
    let mut parts = vec![serde_json::json!({"text": message})];
    for image in images {
        let encoded = image.content.strip_prefix("data:").and_then(|value| value.split_once(",")).map(|(_, data)| data.to_string()).unwrap_or(image.content);
        parts.push(serde_json::json!({"inline_data": {"mime_type": image.mime_type, "data": encoded}}));
    }
    let body = serde_json::json!({"contents": [{"role": "user", "parts": parts}]});
    let response = reqwest::Client::new().post(endpoint).json(&body).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err(format!("Gemini image request failed: {}", response.status())); }
    let text = response.text().await.map_err(|e| e.to_string())?;
    let mut full = String::new();
    for line in text.lines().filter(|line| line.starts_with("data:")) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim_start_matches("data:").trim()) {
            if let Some(delta) = value.pointer("candidates/0/content/parts/0/text").and_then(|v| v.as_str()) { full.push_str(delta); emit_delta(&app, &request_id, delta); }
        }
    }
    let _ = app.emit("chat-done", DonePayload { request_id, full });
    Ok(())
}


const MERGE_MODELS: &[&str] = &["deepseek-v4-pro", "deepseek-v4-flash"];
const JUDGE_MODEL: &str = "deepseek-v4-pro";

async fn merge_single_call(client: &reqwest::Client, model: &str, message: &str) -> Result<String, String> {
    let api_key = deepseek_api_key()?;
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": message }]
    });

    let res = client
        .post(DEEPSEEK_URL)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("{}: request failed: {}", model, e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| format!("{}: read failed: {}", model, e))?;

    if !status.is_success() {
        return Err(format!("{}: {} {}", model, status, &text[..text.len().min(300)]));
    }

    let val: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("{}: parse failed: {}", model, e))?;

    val.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("{}: no content in response", model))
}

#[tauri::command]
async fn chat_merge(app: AppHandle, message: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;

    let _ = app.emit("merge://status", serde_json::json!({
        "status": "Querying models in parallel...",
        "mergePhase": "fanout",
        "mergeProgress": { "completed": 0, "total": MERGE_MODELS.len() }
    }));

    let mut handles = Vec::new();
    for &model in MERGE_MODELS {
        let client = client.clone();
        let message = message.clone();
        let app = app.clone();
        let model_str = model.to_string();
        handles.push(tokio::spawn(async move {
            let result = merge_single_call(&client, &model_str, &message).await;
            let _ = app.emit("merge://status", serde_json::json!({
                "status": format!("{} responded", model_str),
                "mergePhase": "fanout",
                "current": model_str.clone(),
                "ok": result.is_ok()
            }));
            (model_str, result)
        }));
    }

    let mut responses: Vec<(String, String)> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for h in handles {
        match h.await {
            Ok((model, Ok(text))) => responses.push((model, text)),
            Ok((model, Err(e))) => errors.push(format!("{}: {}", model, e)),
            Err(e) => errors.push(format!("task panic: {}", e)),
        }
    }

    if responses.is_empty() {
        return Err(format!("All models failed: {}", errors.join(" | ")));
    }

    if responses.len() == 1 {
        let (model, text) = responses.into_iter().next().unwrap();
        let _ = app.emit("merge://status", serde_json::json!({
            "status": format!("Only {} responded, using it", model),
            "mergePhase": "winner",
            "winner": model
        }));
        emit_merge_text(&app, &text).await;
        let _ = app.emit("merge://done", serde_json::json!({ "ok": true }));
        return Ok(text);
    }

    let _ = app.emit("merge://status", serde_json::json!({
        "status": "Judging responses...",
        "mergePhase": "judging",
        "mergeProgress": { "completed": responses.len(), "total": MERGE_MODELS.len() }
    }));

    let mut judge_prompt = String::from(
        "You are judging responses from multiple AI models to pick the best one for the user. The user's question was:\n\n---\n"
    );
    judge_prompt.push_str(&message);
    judge_prompt.push_str("\n---\n\nHere are the candidate responses:\n\n");
    for (i, (model, text)) in responses.iter().enumerate() {
        judge_prompt.push_str(&format!("=== Response {} (from {}) ===\n{}\n\n", i + 1, model, text));
    }
    judge_prompt.push_str(
        "Pick the single best response based on accuracy, clarity, depth, and how well it answers the user's actual question. Reply with ONLY a number (1, 2, or 3) on the first line indicating which response wins. No explanation, no other text."
    );

    let pick = match merge_single_call(&client, JUDGE_MODEL, &judge_prompt).await {
        Ok(s) => s,
        Err(_) => "1".to_string(),
    };

    let winner_idx = pick
        .trim()
        .chars()
        .find(|c| c.is_ascii_digit())
        .and_then(|c| c.to_digit(10))
        .map(|n| (n as usize).saturating_sub(1))
        .unwrap_or(0)
        .min(responses.len() - 1);

    let (winner_model, winner_text) = responses.into_iter().nth(winner_idx).unwrap();
    let _ = app.emit("merge://status", serde_json::json!({
        "status": format!("{} won", winner_model),
        "mergePhase": "winner",
        "winner": winner_model.clone()
    }));

    emit_merge_text(&app, &winner_text).await;
    let _ = app.emit("merge://done", serde_json::json!({ "ok": true, "winner": winner_model.clone() }));
    Ok(winner_text)
}

async fn emit_merge_text(app: &AppHandle, text: &str) {
	use tokio::time::{sleep, Duration};
	let chars: Vec<char> = text.chars().collect();
	const CHUNK: usize = 12;
	let mut i = 0;
	while i < chars.len() {
		let end = (i + CHUNK).min(chars.len());
		let chunk: String = chars[i..end].iter().collect();
		let _ = app.emit("merge://delta", serde_json::json!({ "text": chunk }));
		i = end;
		if i < chars.len() {
			sleep(Duration::from_millis(20)).await;
		}
	}
}


#[derive(serde::Serialize, Clone)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(serde::Serialize, Clone)]
pub struct SearchResponse {
    pub answer: String,
    pub sources: Vec<SearchResult>,
}

async fn surf_grounded_call(client: &reqwest::Client, query: &str) -> Result<SearchResponse, String> {
    let api_key = std::env::var("SURF_API_KEY")
        .map_err(|_| "SURF_API_KEY is not configured. Web search is unavailable.".to_string())?;
    let payload = serde_json::json!({
        "query": query,
        "model": "gateway-gemini-3-flash",
        "effort": "medium"
    });
    let res = client
        .post("https://unlimited.surf/api/search")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Surf request failed: {}", e))?;
    let status = res.status();
    let raw = res.text().await.map_err(|e| format!("read failed: {}", e))?;
    if !status.is_success() {
        return Err(format!("Surf {}: {}", status, &raw[..raw.len().min(300)]));
    }
    let mut answer = String::new();
    let mut sources: Vec<SearchResult> = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let json_str = if let Some(s) = line.strip_prefix("data: ") { s.trim() }
            else if let Some(s) = line.strip_prefix("data:") { s.trim() }
            else { line };
        if json_str == "[DONE]" { continue; }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(delta) = val.get("delta").and_then(|v| v.as_str()) {
                answer.push_str(delta);
            }
            let results_key = if val.get("results").is_some() { "results" } else { "sources" };
            if let Some(arr) = val.get(results_key).and_then(|v| v.as_array()) {
                for r in arr {
                    if let (Some(title), Some(url)) = (
                        r.get("title").and_then(|v| v.as_str()),
                        r.get("url").and_then(|v| v.as_str()),
                    ) {
                        sources.push(SearchResult {
                            title: title.to_string(),
                            url: url.to_string(),
                            snippet: r.get("snippet").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        });
                    }
                }
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    sources.retain(|s| seen.insert(s.url.clone()));
    Ok(SearchResponse { answer, sources })
}

async fn surf_synthesis_call(_client: &reqwest::Client, query: &str, sources: &[SearchResult]) -> Result<String, String> {
    let mut context = String::from("Web search results for the query:\n\n");
    for (i, source) in sources.iter().take(8).enumerate() {
        context.push_str(&format!("[{}] {}\nURL: {}\nSnippet: {}\n\n", i + 1, source.title, source.url, source.snippet));
    }
    let prompt = format!(
        "{}\n\nUsing only the above sources, answer this question thoroughly: {}\n\nCite sources inline as [1], [2], etc.",
        context, query
    );
    merge_single_call(_client, DEFAULT_DEEPSEEK_MODEL, &prompt).await
}

#[tauri::command]
async fn chat_surf(app: AppHandle, query: String) -> Result<SearchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let _ = app.emit("surf://status", serde_json::json!({
        "status": "Searching the web...",
        "phase": "search"
    }));

    let grounded = surf_grounded_call(&client, &query).await?;

    if grounded.sources.is_empty() {
        let _ = app.emit("surf://status", serde_json::json!({
            "status": "No sources, using grounded answer",
            "phase": "winner"
        }));
        return Ok(grounded);
    }

    let _ = app.emit("surf://status", serde_json::json!({
        "status": format!("Got {} sources, synthesizing with DeepSeek...", grounded.sources.len()),
        "phase": "synthesis"
    }));

    let synthesis = surf_synthesis_call(&client, &query, &grounded.sources).await;

    let final_answer = match synthesis {
        Ok(syn) if !syn.trim().is_empty() => {
            let _ = app.emit("surf://status", serde_json::json!({
                "status": "Judging answers...",
                "phase": "judging"
            }));
            let judge_prompt = format!(
                "Two answers to the question: \"{}\"\n\n=== Answer A (gemini-3-flash with web grounding) ===\n{}\n\n=== Answer B (DeepSeek synthesis over same sources) ===\n{}\n\nWhich is more accurate, thorough, and well-cited? Reply with ONLY 'A' or 'B' on the first line.",
                query, grounded.answer, syn
            );
            let pick = merge_single_call(&client, JUDGE_MODEL, &judge_prompt)
                .await
                .unwrap_or_else(|_| "A".to_string());
            let pick_b = pick.trim().to_uppercase().starts_with('B');
            let _ = app.emit("surf://status", serde_json::json!({
                "status": if pick_b { "DeepSeek synthesis won" } else { "grounded answer won" },
                "phase": "winner",
                "winner": if pick_b { "synthesis" } else { "grounded" }
            }));
            if pick_b { syn } else { grounded.answer.clone() }
        }
        _ => grounded.answer.clone()
    };

    Ok(SearchResponse { answer: final_answer, sources: grounded.sources })
}


fn resolve_path(path: &str, base_dir: Option<&str>) -> Result<PathBuf, String> {
    let input = Path::new(path);
    if input.is_absolute() {
        return Ok(input.to_path_buf());
    }

    let base = base_dir
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    Ok(base.join(input))
}

#[tauri::command]
async fn tool_read_file(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		fs::read_to_string(&resolved)
			.map_err(|e| format!("read_file error for {}: {}", resolved.display(), e))
	})
	.await
	.map_err(|e| format!("read_file join error: {}", e))?
}

#[tauri::command]
async fn tool_write_file(
    path: String,
    content: String,
    base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		if let Some(parent) = resolved.parent() {
			fs::create_dir_all(parent).map_err(|e| format!("create_dir error: {}", e))?;
		}
		#[cfg(target_os = "windows")]
		let to_write = {
			let mut out = String::with_capacity(content.len() + content.len() / 40);
			let bytes = content.as_bytes();
			for (i, &b) in bytes.iter().enumerate() {
				if b == b'\n' && (i == 0 || bytes[i - 1] != b'\r') {
					out.push('\r');
				}
				out.push(b as char);
			}
			out
		};
		#[cfg(not(target_os = "windows"))]
		let to_write = content.clone();
		fs::write(&resolved, &to_write)
			.map_err(|e| format!("write_file error for {}: {}", resolved.display(), e))?;
		Ok(format!(
			"Written {} bytes to {}",
			to_write.len(),
			resolved.display()
		))
	})
	.await
	.map_err(|e| format!("write_file join error: {}", e))?
}

#[tauri::command]
async fn tool_append_file(
    path: String,
    content: String,
    base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		use std::io::Write;
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		if let Some(parent) = resolved.parent() {
			fs::create_dir_all(parent).map_err(|e| format!("create_dir error: {}", e))?;
		}
		#[cfg(target_os = "windows")]
		let to_write = {
			let mut out = String::with_capacity(content.len() + content.len() / 40);
			let bytes = content.as_bytes();
			for (i, &b) in bytes.iter().enumerate() {
				if b == b'\n' && (i == 0 || bytes[i - 1] != b'\r') {
					out.push('\r');
				}
				out.push(b as char);
			}
			out
		};
		#[cfg(not(target_os = "windows"))]
		let to_write = content.clone();
		let mut file = fs::OpenOptions::new()
			.create(true)
			.append(true)
			.open(&resolved)
			.map_err(|e| format!("append_file error for {}: {}", resolved.display(), e))?;
		file.write_all(to_write.as_bytes())
			.map_err(|e| format!("append_file error: {}", e))?;
		Ok(format!(
			"Appended {} bytes to {}",
			to_write.len(),
			resolved.display()
		))
	})
	.await
	.map_err(|e| format!("append_file join error: {}", e))?
}

#[tauri::command]
async fn tool_create_directory(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		fs::create_dir_all(&resolved)
			.map_err(|e| format!("create_directory error for {}: {}", resolved.display(), e))?;
		Ok(format!("Created directory: {}", resolved.display()))
	})
	.await
	.map_err(|e| format!("create_directory join error: {}", e))?
}

#[tauri::command]
async fn tool_copy_file(
    source: String,
    destination: String,
    base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let src = resolve_path(&source, base_dir.as_deref())?;
		let dst = resolve_path(&destination, base_dir.as_deref())?;
		if let Some(parent) = dst.parent() {
			fs::create_dir_all(parent).map_err(|e| format!("create_dir error: {}", e))?;
		}
		let bytes = fs::copy(&src, &dst).map_err(|e| format!("copy_file error: {}", e))?;
		Ok(format!(
			"Copied {} bytes from {} to {}",
			bytes,
			src.display(),
			dst.display()
		))
	})
	.await
	.map_err(|e| format!("copy_file join error: {}", e))?
}

#[tauri::command]
async fn tool_move_file(
    source: String,
    destination: String,
    base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let src = resolve_path(&source, base_dir.as_deref())?;
		let dst = resolve_path(&destination, base_dir.as_deref())?;
		if let Some(parent) = dst.parent() {
			fs::create_dir_all(parent).map_err(|e| format!("create_dir error: {}", e))?;
		}
		fs::rename(&src, &dst).map_err(|e| format!("move_file error: {}", e))?;
		Ok(format!("Moved {} to {}", src.display(), dst.display()))
	})
	.await
	.map_err(|e| format!("move_file join error: {}", e))?
}

#[tauri::command]
async fn tool_file_exists(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let p = resolve_path(&path, base_dir.as_deref())?;
		Ok(if p.exists() {
			if p.is_dir() {
				format!("Directory exists: {}", p.display())
			} else {
				format!("File exists: {}", p.display())
			}
		} else {
			format!("Path does not exist: {}", p.display())
		})
	})
	.await
	.map_err(|e| format!("file_exists join error: {}", e))?
}

#[tauri::command]
async fn tool_file_info(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		let meta = fs::metadata(&resolved)
			.map_err(|e| format!("file_info error for {}: {}", resolved.display(), e))?;
		let kind = if meta.is_dir() {
			"directory"
		} else if meta.is_file() {
			"file"
		} else {
			"other"
		};
		let readonly = meta.permissions().readonly();
		let modified = meta
			.modified()
			.ok()
			.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
			.map(|d| d.as_secs().to_string())
			.unwrap_or_else(|| "unknown".into());
		Ok(format!(
			"Path: {}\nType: {}\nSize: {} bytes\nReadonly: {}\nModifiedUnix: {}",
			resolved.display(),
			kind,
			meta.len(),
			readonly,
			modified
		))
	})
	.await
	.map_err(|e| format!("file_info join error: {}", e))?
}

#[tauri::command]
async fn tool_read_file_range(
	path: String,
	start: usize,
	end: usize,
	base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		if start == 0 || end < start {
			return Err("read-file-range requires 1-based start and end >= start".to_string());
		}
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		let file = fs::File::open(&resolved)
			.map_err(|e| format!("read_file_range error for {}: {}", resolved.display(), e))?;
		let reader = BufReader::new(file);
		let mut lines = Vec::new();
		for (idx, line) in reader.lines().enumerate() {
			let line_no = idx + 1;
			if line_no > end {
				break;
			}
			if line_no >= start {
				lines.push(format!("{}: {}", line_no, line.map_err(|e| e.to_string())?));
			}
		}
		Ok(lines.join("\n"))
	})
	.await
	.map_err(|e| format!("read_file_range join error: {}", e))?
}

#[tauri::command]
async fn tool_delete_file(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let p = resolve_path(&path, base_dir.as_deref())?;
		if p.is_dir() {
			fs::remove_dir_all(&p).map_err(|e| format!("delete_dir error: {}", e))?;
			Ok(format!("Deleted directory: {}", p.display()))
		} else {
			fs::remove_file(&p).map_err(|e| format!("delete_file error: {}", e))?;
			Ok(format!("Deleted file: {}", p.display()))
		}
	})
	.await
	.map_err(|e| format!("delete_file join error: {}", e))?
}

#[tauri::command]
async fn tool_list_directory(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		let entries = fs::read_dir(&resolved)
			.map_err(|e| format!("list_directory error for {}: {}", resolved.display(), e))?;
		let mut lines = Vec::new();
		for entry in entries.flatten() {
			let name = entry.file_name().to_string_lossy().to_string();
			let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
			lines.push(if is_dir { format!("{}/", name) } else { name });
		}
		lines.sort();
		Ok(lines.join("\n"))
	})
	.await
	.map_err(|e| format!("list_directory join error: {}", e))?
}

#[tauri::command]
async fn tool_search_files(
    path: String,
    query: String,
    base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || tool_search_files_inner(path, query, base_dir))
		.await
		.map_err(|e| format!("search_files join error: {}", e))?
}

fn tool_search_files_inner(
    path: String,
    query: String,
    base_dir: Option<String>,
) -> Result<String, String> {
    use walkdir::WalkDir;
    let resolved = resolve_path(&path, base_dir.as_deref())?;
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    for entry in WalkDir::new(&resolved).max_depth(8).into_iter().flatten() {
        if entry.file_type().is_file() {
            let file_path = entry.path().to_string_lossy().to_string();
            let ext = entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if matches!(
                ext,
                "exe"
                    | "dll"
                    | "bin"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "ico"
                    | "woff"
                    | "woff2"
                    | "ttf"
                    | "zip"
                    | "tar"
                    | "gz"
            ) {
                continue;
            }
            if let Ok(content) = fs::read_to_string(entry.path()) {
                let content_lower = content.to_lowercase();
                if content_lower.contains(&query_lower) {
                    for (i, line) in content.lines().enumerate() {
                        if line.to_lowercase().contains(&query_lower) {
                            results.push(format!("{}:{}: {}", file_path, i + 1, line.trim()));
                            if results.len() >= 50 {
                                break;
                            }
                        }
                    }
                }
            }
            if results.len() >= 50 {
                break;
            }
        }
    }

    if results.is_empty() {
        Ok(format!(
            "No matches found for '{}' in {}",
            query,
            resolved.display()
        ))
    } else {
        Ok(results.join("\n"))
    }
}

#[tauri::command]
async fn tool_edit_file(
	path: String,
	find: String,
	replace: String,
	base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || tool_edit_file_inner(path, find, replace, base_dir))
		.await
		.map_err(|e| format!("edit_file join error: {}", e))?
}

fn tool_edit_file_inner(
	path: String,
	find: String,
	replace: String,
	base_dir: Option<String>,
) -> Result<String, String> {
	if find.trim().is_empty() {
		return Err("edit-file: 'find' parameter is required and cannot be empty".to_string());
	}
	let resolved = resolve_path(&path, base_dir.as_deref())?;
    let content = fs::read_to_string(&resolved)
        .map_err(|e| format!("read error for {}: {}", resolved.display(), e))?;

    if content.contains(&find) {
        let new_content = content.replacen(&find, &replace, 1);
        fs::write(&resolved, &new_content)
            .map_err(|e| format!("write error for {}: {}", resolved.display(), e))?;
        return Ok(format!(
            "Edited {} - replaced 1 occurrence",
            resolved.display()
        ));
    }

    let file_uses_crlf = content.matches("\r\n").count() * 2 > content.matches('\n').count();

    let file_lf = content.replace("\r\n", "\n");
    let find_lf = find.replace("\r\n", "\n");
    let replace_lf = replace.replace("\r\n", "\n");

    if !file_lf.contains(&find_lf) {
        return Err(format!(
            "String not found in {}: {:?}",
            resolved.display(),
            &find[..find.len().min(80)]
        ));
    }

    let new_lf = file_lf.replacen(&find_lf, &replace_lf, 1);
    let new_content = if file_uses_crlf {
        new_lf.replace('\n', "\r\n")
    } else {
        new_lf
    };
    fs::write(&resolved, &new_content)
        .map_err(|e| format!("write error for {}: {}", resolved.display(), e))?;
    Ok(format!(
        "Edited {} - replaced 1 occurrence (line endings normalized)",
        resolved.display()
    ))
}


#[derive(Serialize)]
struct UploadedFile {
    name: String,
    path: String,
    size: u64,
    #[serde(rename = "mimeType")]
    mime_type: String,
    #[serde(rename = "isBinary")]
    is_binary: bool,
    content: String,
}

fn guess_mime(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "txt" | "md" | "log" => "text/plain".into(),
        "json" => "application/json".into(),
        "js" | "mjs" => "text/javascript".into(),
        "ts" | "tsx" => "text/typescript".into(),
        "py" => "text/x-python".into(),
        "rs" => "text/x-rust".into(),
        "html" => "text/html".into(),
        "css" => "text/css".into(),
        "png" => "image/png".into(),
        "jpg" | "jpeg" => "image/jpeg".into(),
        "gif" => "image/gif".into(),
        "webp" => "image/webp".into(),
        "pdf" => "application/pdf".into(),
        _ => "application/octet-stream".into(),
    }
}

fn is_text_mime(mime: &str) -> bool {
    mime.starts_with("text/") || mime == "application/json" || mime == "application/xml"
}

#[tauri::command]
async fn tool_read_uploaded_file(path: String) -> Result<UploadedFile, String> {
	tokio::task::spawn_blocking(move || {
		use base64::{engine::general_purpose, Engine as _};

		let meta = fs::metadata(&path).map_err(|e| format!("stat error: {}", e))?;
		let size = meta.len();
		if size > 5 * 1024 * 1024 {
			return Err(format!("File too large ({} bytes, max 5MB)", size));
		}

		let mime = guess_mime(&path);
		let name = Path::new(&path)
			.file_name()
			.map(|n| n.to_string_lossy().to_string())
			.unwrap_or_else(|| path.clone());

		let bytes = fs::read(&path).map_err(|e| format!("read error: {}", e))?;
		let is_binary = !is_text_mime(&mime);

		let content = if is_binary {
			general_purpose::STANDARD.encode(&bytes)
		} else {
			String::from_utf8_lossy(&bytes).to_string()
		};

		Ok(UploadedFile {
			name,
			path: path.clone(),
			size,
			mime_type: mime,
			is_binary,
			content,
		})
	})
	.await
	.map_err(|e| format!("read_uploaded_file join error: {}", e))?
}

#[tauri::command]
fn select_directory(initial: Option<String>) -> Result<Option<String>, String> {
    select_directory_impl(initial)
}

#[cfg(target_os = "windows")]
fn select_directory_impl(initial: Option<String>) -> Result<Option<String>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
        FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("Could not initialize folder picker: {}", e))?;

        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let options = dialog.GetOptions()?;
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;

            if let Some(initial_dir) =
                initial.filter(|p| !p.trim().is_empty() && Path::new(p).exists())
            {
                let wide: Vec<u16> = initial_dir
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let folder: windows::core::Result<IShellItem> =
                    SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None::<&IBindCtx>);
                if let Ok(folder) = folder {
                    let _ = dialog.SetFolder(&folder);
                }
            }

            if let Err(err) = dialog.Show(Some(HWND::default())) {
                if err.code() == ERROR_CANCELLED.to_hresult() {
                    return Ok(None);
                }
                return Err(err);
            }

            let item = dialog.GetResult()?;
            let display_name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = display_name.to_string()?;
            CoTaskMemFree(Some(display_name.0 as _));
            Ok(Some(path))
        })();

        CoUninitialize();
        result.map_err(|e| format!("Folder picker failed: {}", e))
    }
}

#[cfg(not(target_os = "windows"))]
fn select_directory_impl(_initial: Option<String>) -> Result<Option<String>, String> {
    Ok(None)
}


#[tauri::command]
async fn tool_run_command(command: String, workdir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || tool_run_command_inner(command, workdir))
		.await
		.map_err(|e| format!("run_command task join error: {}", e))?
}

#[tauri::command]
async fn codex_cli_run(prompt: String, working_dir: String) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let root = PathBuf::from(&working_dir);
		if !root.is_dir() {
			return Err(format!("Codex workspace is not a directory: {}", root.display()));
		}
		let output = Command::new("codex")
			.args(["exec", "--json", "--sandbox", "workspace-write", "--ask-for-approval", "on-request"])
			.arg("--cd")
			.arg(&root)
			.arg(&prompt)
			.current_dir(&root)
			.output()
			.map_err(|e| format!("Could not start Codex CLI: {}", e))?;
		let stdout = String::from_utf8_lossy(&output.stdout);
		let stderr = String::from_utf8_lossy(&output.stderr);
		if !output.status.success() {
			return Err(format!("Codex CLI exited with {}\n{}", output.status, stderr.trim()));
		}
		if stdout.trim().is_empty() { Ok(stderr.into_owned()) } else { Ok(stdout.into_owned()) }
	})
	.await
	.map_err(|e| format!("Codex CLI join error: {}", e))?
}

fn extract_powershell_script(rest: &str) -> String {
	let trimmed = rest.trim();
	let lower = trimmed.to_ascii_lowercase();

	if lower.contains("-file ") || lower.contains("-encodedcommand ") {
		return String::new();
	}

	let cmd_pos = lower.find("-command");
	if let Some(pos) = cmd_pos {
		let after = &trimmed[pos + "-command".len()..];
		let after = after.trim_start();
		if after.is_empty() {
			return String::new();
		}
		let first = after.chars().next().unwrap();
		if first == '"' || first == '\'' {
			let quote = first;
			let inner = &after[1..];
			if let Some(end) = inner.find(quote) {
				return inner[..end].to_string();
			}
			return inner.to_string();
		}
		return after.to_string();
	}

	if trimmed.starts_with('-') {
		return String::new();
	}
	trimmed.to_string()
}

fn split_shell_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

fn tool_run_command_inner(command: String, workdir: Option<String>) -> Result<String, String> {
    use std::process::Stdio;
    use std::time::Duration;
	let command = if cfg!(target_os = "windows") {
		let trimmed = command.trim_start();
		let lower = trimmed.to_ascii_lowercase();
		if lower == "cat" || lower.starts_with("cat ") {
			format!("Get-Content {}", trimmed.get(3..).unwrap_or("").trim())
		} else if lower == "ls" || lower.starts_with("ls ") {
			format!("Get-ChildItem {}", trimmed.get(2..).unwrap_or("").trim())
		} else {
			command
		}
	} else {
		command
	};

    let trimmed = command.trim_start();
    let lower = trimmed.to_ascii_lowercase();

    let mut cmd = if cfg!(target_os = "windows") {
        if lower.starts_with("powershell ") || lower.starts_with("powershell.exe ")
            || lower == "powershell" || lower == "powershell.exe"
        {
            let rest = trimmed.splitn(2, char::is_whitespace).nth(1).unwrap_or("").trim();
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);
            if !rest.is_empty() {
                let script = extract_powershell_script(rest);
                if !script.is_empty() {
                    use base64::{engine::general_purpose, Engine as _};
                    let utf16_bytes: Vec<u8> = script
                        .encode_utf16()
                        .flat_map(|u| u.to_le_bytes())
                        .collect();
                    let encoded = general_purpose::STANDARD.encode(&utf16_bytes);
                    c.arg("-EncodedCommand");
                    c.arg(encoded);
                } else {
                    for arg in split_shell_args(rest) {
                        c.arg(arg);
                    }
                }
            }
            c
        } else if lower.starts_with("pwsh ") || lower == "pwsh" {
            let rest = trimmed.splitn(2, char::is_whitespace).nth(1).unwrap_or("").trim();
            let mut c = Command::new("pwsh");
            c.args(["-NoProfile", "-NonInteractive"]);
            if !rest.is_empty() {
                c.arg("-Command");
                c.arg(rest);
            }
            c
        } else if lower.starts_with("cmd /c ") || lower.starts_with("cmd.exe /c ") {
            let after = if lower.starts_with("cmd.exe /c ") {
                &trimmed[11..]
            } else {
                &trimmed[7..]
            };
            let mut c = Command::new("cmd");
            c.args(["/C", after]);
            c
        } else {
            let mut c = Command::new("cmd");
            c.args(["/C", &command]);
            c
        }
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    if let Some(dir) = &workdir {
        if !dir.is_empty() && Path::new(dir).exists() {
            cmd.current_dir(dir);
        }
    }

    let timeout = Duration::from_secs(30);
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let output = {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = child.wait_with_output();
            let _ = tx.send(result);
        });
        match rx.recv_timeout(timeout) {
            Ok(result) => result.map_err(|e| format!("Failed to collect output: {}", e))?,
            Err(_) => {
                return Err(format!(
                    "Command timed out after {}s: {}",
                    timeout.as_secs(),
                    &command[..command.len().min(120)]
                ))
            }
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    let mut result = String::new();
    if !stdout.is_empty() {
        result.push_str(stdout.trim_end());
    }
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&format!("[stderr]\n{}", stderr.trim_end()));
    }
    if result.is_empty() {
        result = format!("(no output, exit code: {})", exit_code);
    } else if exit_code != 0 {
        result.push_str(&format!("\n(exit code: {})", exit_code));
    }

    Ok(result)
}


#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}


#[derive(Clone, Serialize)]
struct DownloadProgress {
    #[serde(rename = "requestId")]
    request_id: String,
    downloaded: u64,
    total: u64,
    percent: f32,
}

#[tauri::command]
async fn download_and_run_update(
    app: AppHandle,
    request_id: String,
    url: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Meridian-Updater/1.0)")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download error: HTTP {}", res.status()));
    }

    let total = res.content_length().unwrap_or(0);
    let temp_new = std::env::temp_dir().join("meridian-update-new.exe");

    {
        let mut file = std::fs::File::create(&temp_new)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        let mut stream = res.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            file.write_all(&chunk)
                .map_err(|e| format!("Write error: {}", e))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed().as_millis() >= 80 || (total > 0 && downloaded == total) {
                last_emit = std::time::Instant::now();
                let percent = if total > 0 {
                    (downloaded as f32 / total as f32) * 100.0
                } else {
                    0.0
                };
                let _ = app.emit(
                    "update-progress",
                    DownloadProgress {
                        request_id: request_id.clone(),
                        downloaded,
                        total,
                        percent,
                    },
                );
            }
        }
    } // file dropped and flushed here

    let current_exe =
        std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;
    let current_exe_str = current_exe.to_string_lossy().to_string();
    let temp_new_str = temp_new.to_string_lossy().to_string();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let install_location: Option<String> = {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use std::process::Command as Cmd;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;

            let reg_keys = [
                r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Meridian",
                r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Meridian",
                r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Meridian",
            ];

            let mut found: Option<String> = None;
            for key in reg_keys.iter() {
                let out = Cmd::new("reg")
                    .args(["query", key, "/v", "InstallLocation"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .ok();
                if let Some(o) = out {
                    let s = String::from_utf8_lossy(&o.stdout).to_string();
                    if let Some(line) = s.lines().find(|l| l.contains("InstallLocation")) {
                        if let Some(after) = line.split("REG_SZ").nth(1) {
                            let dir = after.trim().trim_end_matches('\\').to_string();
                            if !dir.is_empty() {
                                let exe = std::path::PathBuf::from(&dir).join("meridian.exe");
                                if exe.exists() {
                                    found = Some(exe.to_string_lossy().to_string());
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if found.is_none() {
                if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
                    let candidate = std::path::PathBuf::from(local_app)
                        .join("Programs")
                        .join("meridian")
                        .join("meridian.exe");
                    if candidate.exists() {
                        found = Some(candidate.to_string_lossy().to_string());
                    }
                }
            }
            if found.is_none() {
                if let Ok(pf) = std::env::var("ProgramFiles") {
                    let candidate = std::path::PathBuf::from(pf)
                        .join("meridian")
                        .join("meridian.exe");
                    if candidate.exists() {
                        found = Some(candidate.to_string_lossy().to_string());
                    }
                }
            }

            found
        }
        #[cfg(not(target_os = "windows"))]
        {
            None
        }
    };

    let mut targets: Vec<String> = vec![current_exe_str.clone()];
    if let Some(ref installed) = install_location {
        if installed != &current_exe_str {
            targets.push(installed.clone());
        }
    }

    let relaunch_path = install_location.as_deref().unwrap_or(&current_exe_str);
    let relaunch_dir = std::path::Path::new(relaunch_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| String::from("."));

    let log_path = std::env::temp_dir()
        .join("meridian-updater.log")
        .to_string_lossy()
        .to_string();

    fn swap_block(target: &str, new: &str, log: &str) -> String {
        let old_bak = format!("{}.old", target);
        format!(
            "Add-Content -Path '{log}' -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Swapping {target}\"; \
             $swapped_{safe} = $false; \
             for ($i=0; $i -lt 15; $i++) {{ \
               try {{ \
                 if (Test-Path '{old_bak}') {{ Remove-Item '{old_bak}' -Force -ErrorAction SilentlyContinue }}; \
                 Rename-Item '{target}' '{old_bak}' -Force -ErrorAction Stop; \
                 Copy-Item '{new}' '{target}' -Force -ErrorAction Stop; \
                 $swapped_{safe} = $true; \
                 Add-Content -Path '{log}' -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Swap OK: {target}\"; \
                 break \
               }} catch {{ \
                 Add-Content -Path '{log}' -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Swap attempt $i failed for {target}: $($_.Exception.Message)\"; \
                 Start-Sleep -Milliseconds 600 \
               }} \
             }}; \
             if (-not $swapped_{safe}) {{ \
               Add-Content -Path '{log}' -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Rename failed, trying direct copy for {target}\"; \
               for ($j=0; $j -lt 10; $j++) {{ \
                 try {{ Copy-Item '{new}' '{target}' -Force -ErrorAction Stop; \
                   $swapped_{safe} = $true; \
                   Add-Content -Path '{log}' -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Direct copy OK: {target}\"; \
                   break }} \
                 catch {{ Start-Sleep -Milliseconds 800 }} \
               }} \
             }}; ",
            log = log,
            target = target,
            new = new,
            old_bak = old_bak,
            safe = target.chars().filter(|c| c.is_alphanumeric()).collect::<String>(),
        )
    }

    let swap_blocks: String = targets
        .iter()
        .map(|t| swap_block(t, &temp_new_str, &log_path))
        .collect();

    let first_safe: String = current_exe_str
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect();

    let ps_script = format!(
        "$ErrorActionPreference = 'Continue'; \
         $log = '{log}'; \
         Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))] === Updater started, waiting for PID {pid} ===\"; \
         $pid_target = {pid}; \
         $sw = [System.Diagnostics.Stopwatch]::StartNew(); \
         while ((Get-Process -Id $pid_target -ErrorAction SilentlyContinue) -and $sw.Elapsed.TotalSeconds -lt 25) {{ Start-Sleep -Milliseconds 200 }}; \
         Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] App process exited, waited $([math]::Round($sw.Elapsed.TotalSeconds,1))s\"; \
         Start-Sleep -Milliseconds 500; \
         {swap_blocks}\
         if ($swapped_{first_safe}) {{ \
           Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Relaunching: {relaunch}\"; \
           try {{ Start-Process -FilePath '{relaunch}' -WorkingDirectory '{relaunch_dir}' }} \
           catch {{ Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] Relaunch FAILED: $($_.Exception.Message)\" }} \
         }} else {{ \
           Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] All swaps failed â€” NOT relaunching\" \
         }}; \
         try {{ Remove-Item '{new}' -Force -ErrorAction SilentlyContinue }} catch {{}}; \
         Add-Content -Path $log -Value \"[$([DateTime]::Now.ToString('HH:mm:ss'))] === Updater done ===\"; \
         Remove-Item $PSCommandPath -Force -ErrorAction SilentlyContinue",
        log = log_path,
        pid = std::process::id(),
        swap_blocks = swap_blocks,
        first_safe = first_safe,
        relaunch = relaunch_path,
        relaunch_dir = relaunch_dir,
        new = temp_new_str,
    );

    let ps_name = format!("meridian-updater-{}.ps1", timestamp);
    let ps_path = std::env::temp_dir().join(&ps_name);
    std::fs::write(&ps_path, &ps_script)
        .map_err(|e| format!("Failed to write updater script: {}", e))?;

    let ps_path_str = ps_path.to_string_lossy().to_string();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;

            let args = format!(
                "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"{}\"",
                ps_path_str
            );

            let elevated = unsafe {
                use windows::core::PCWSTR;
                use windows::Win32::UI::Shell::ShellExecuteW;
                use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

                let verb: Vec<u16> = "runas\0".encode_utf16().collect();
                let file: Vec<u16> = "powershell.exe\0".encode_utf16().collect();
                let params: Vec<u16> = format!("{}\0", args).encode_utf16().collect();

                let result = ShellExecuteW(
                    None,
                    PCWSTR(verb.as_ptr()),
                    PCWSTR(file.as_ptr()),
                    PCWSTR(params.as_ptr()),
                    None,
                    SW_HIDE,
                );
                result.0 as usize > 32
            };

            if !elevated {
                let _ = std::process::Command::new("powershell")
                    .args([
                        "-NoProfile",
                        "-NonInteractive",
                        "-WindowStyle",
                        "Hidden",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        &ps_path_str,
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        std::process::exit(0);
    });

    Ok(current_exe_str)
}


#[tauri::command]
async fn download_and_run_installer(
    app: AppHandle,
    request_id: String,
    url: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Meridian-Updater/1.0)")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Download error: HTTP {}", res.status()));
    }

    let total = res.content_length().unwrap_or(0);
    let temp_installer = std::env::temp_dir().join("meridian-setup-update.exe");

    {
        let mut file = std::fs::File::create(&temp_installer)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        let mut stream = res.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            file.write_all(&chunk)
                .map_err(|e| format!("Write error: {}", e))?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed().as_millis() >= 80 || (total > 0 && downloaded == total) {
                last_emit = std::time::Instant::now();
                let percent = if total > 0 {
                    (downloaded as f32 / total as f32) * 100.0
                } else {
                    0.0
                };
                let _ = app.emit(
                    "update-progress",
                    DownloadProgress {
                        request_id: request_id.clone(),
                        downloaded,
                        total,
                        percent,
                    },
                );
            }
        }
    } // file flushed and closed

    let installer_str = temp_installer.to_string_lossy().to_string();
    let installer_str_ret = installer_str.clone();

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        #[cfg(target_os = "windows")]
        {
            use windows::core::PCWSTR;
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

            let verb: Vec<u16> = "runas\0".encode_utf16().collect();
            let file: Vec<u16> = format!("{}\0", installer_str).encode_utf16().collect();
            let params: Vec<u16> = "/S\0".encode_utf16().collect();

            let launched = unsafe {
                let result = ShellExecuteW(
                    None,
                    PCWSTR(verb.as_ptr()),
                    PCWSTR(file.as_ptr()),
                    PCWSTR(params.as_ptr()),
                    None,
                    SW_SHOWNORMAL,
                );
                result.0 as usize > 32
            };

            if !launched {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                let _ = std::process::Command::new(&installer_str)
                    .args(["/S"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn();
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        std::process::exit(0);
    });

    Ok(installer_str_ret)
}


use std::sync::mpsc as std_mpsc;

type McpPendingMap = Arc<Mutex<HashMap<u64, std_mpsc::Sender<serde_json::Value>>>>;

struct McpProcess {
    stdin: Arc<Mutex<std::process::ChildStdin>>,
    pending: McpPendingMap,
    stderr_tail: Arc<Mutex<String>>,
    initialized: Arc<Mutex<bool>>,
    child: Arc<Mutex<Option<std::process::Child>>>,
}

#[derive(Serialize)]
struct McpProcessState {
    running: bool,
    initialized: bool,
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut c) = guard.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
        if let Ok(mut map) = self.pending.lock() {
            for (_, tx) in map.drain() {
                let _ = tx.send(serde_json::json!({
                    "error": { "message": "MCP process terminated" }
                }));
            }
        }
    }
}

static MCP_PROCESSES: std::sync::LazyLock<Arc<Mutex<HashMap<String, McpProcess>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

static MCP_RPC_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_rpc_id() -> u64 {
    MCP_RPC_COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

fn remember_process_output(tail: &Arc<Mutex<String>>, chunk: &str) {
    const MAX_OUTPUT_BYTES: usize = 4000;
    let mut buf = tail.lock().unwrap_or_else(|e| e.into_inner());
    buf.push_str(chunk);
    if buf.len() > MAX_OUTPUT_BYTES {
        let excess = buf.len() - MAX_OUTPUT_BYTES;
        let drain_to = buf
            .char_indices()
            .find(|(idx, _)| *idx >= excess)
            .map(|(idx, _)| idx)
            .unwrap_or(buf.len());
        buf.drain(..drain_to);
    }
}

fn process_output_detail(tail: &Arc<Mutex<String>>) -> String {
    let output = tail
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .trim()
        .to_string();
    if output.is_empty() {
        String::new()
    } else {
        format!("\nProcess output:\n{}", output)
    }
}

fn spawn_mcp_stderr_reader(
    server_id: String,
    stderr: std::process::ChildStderr,
    stderr_tail: Arc<Mutex<String>>,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name(format!("mcp-stderr-{}", server_id))
        .spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => remember_process_output(&stderr_tail, &line),
                    Err(_) => break,
                }
            }
        })
        .map(|_| ())
        .map_err(|e| format!("Failed to spawn MCP stderr reader thread: {}", e))
}

fn spawn_mcp_reader(
    server_id: String,
    stdout: std::process::ChildStdout,
    pending: McpPendingMap,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name(format!("mcp-reader-{}", server_id))
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break, // EOF â€” process exited
                        Ok(_) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                                if let Some(id) = val.get("id").and_then(|v| v.as_u64()) {
                                    let sender = pending
                                        .lock()
                                        .unwrap_or_else(|e| e.into_inner())
                                        .remove(&id);
                                    if let Some(tx) = sender {
                                        let _ = tx.send(val);
                                    }
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            }));
            if result.is_err() {
                eprintln!("MCP reader for '{}' panicked", server_id);
            }
            {
                let mut map = pending.lock().unwrap_or_else(|e| e.into_inner());
                for (_, tx) in map.drain() {
                    let _ = tx.send(serde_json::json!({
                        "error": { "message": format!("MCP process '{}' closed", server_id) }
                    }));
                }
            }

            let removed = {
                let mut procs = MCP_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
                let should_remove = procs
                    .get(&server_id)
                    .map(|proc| Arc::ptr_eq(&proc.pending, &pending))
                    .unwrap_or(false);
                if should_remove {
                    procs.remove(&server_id)
                } else {
                    None
                }
            };
            drop(removed);
        })
        .map(|_| ())
        .map_err(|e| format!("Failed to spawn MCP reader thread: {}", e))
}

#[tauri::command]
fn mcp_spawn(
    server_id: String,
    mut command: String,
    mut args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<(), String> {
    use std::process::Stdio;

    if server_id.starts_with("roblox-studio") {
        let launch = resolve_roblox_mcp_launch(false)?;
        command = launch.command;
        args = launch.args;
    }

    if command.trim().is_empty() {
        return Err("MCP command is empty".to_string());
    }

    let old = MCP_PROCESSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&server_id);
    drop(old);

    let mut cmd = Command::new(&command);
    cmd.args(&args);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    for (k, v) in &env {
        cmd.env(k, v);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server '{}': {}", command, e))?;

    let stdin = child.stdin.take().ok_or("Failed to get MCP stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get MCP stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get MCP stderr")?;

    let pending: McpPendingMap = Arc::new(Mutex::new(HashMap::new()));
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Err(e) = spawn_mcp_reader(server_id.clone(), stdout, Arc::clone(&pending)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }
    if let Err(e) = spawn_mcp_stderr_reader(server_id.clone(), stderr, Arc::clone(&stderr_tail)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(e);
    }

    MCP_PROCESSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            server_id,
            McpProcess {
                stdin: Arc::new(Mutex::new(stdin)),
                pending,
                stderr_tail,
                initialized: Arc::new(Mutex::new(false)),
                child: Arc::new(Mutex::new(Some(child))),
            },
        );
    Ok(())
}

#[tauri::command]
async fn mcp_notify(
    server_id: String,
    method: String,
    params: serde_json::Value,
) -> Result<(), String> {
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    });
    let mut line = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode MCP notification: {}", e))?;
    line.push('\n');

    let stdin_arc = {
        let procs = MCP_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        let proc = procs
            .get(&server_id)
            .ok_or_else(|| format!("MCP server '{}' not running", server_id))?;
        Arc::clone(&proc.stdin)
    };

    let write_result = {
        let line_bytes = line.into_bytes();
        tokio::task::spawn_blocking(move || {
            let mut stdin = stdin_arc.lock().unwrap_or_else(|e| e.into_inner());
            stdin.write_all(&line_bytes).and_then(|_| stdin.flush())
        })
        .await
        .map_err(|e| format!("MCP notification task join error: {}", e))?
    };

    write_result.map_err(|e| format!("MCP notification write error: {}", e))
}

#[tauri::command]
async fn mcp_call(
    server_id: String,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = next_rpc_id();
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let mut line = serde_json::to_string(&request)
        .map_err(|e| format!("Failed to encode MCP request: {}", e))?;
    line.push('\n');

    let (stdin_arc, pending, stderr_tail, initialized) = {
        let procs = MCP_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        let proc = procs
            .get(&server_id)
            .ok_or_else(|| format!("MCP server '{}' not running", server_id))?;
        (
            Arc::clone(&proc.stdin),
            Arc::clone(&proc.pending),
            Arc::clone(&proc.stderr_tail),
            Arc::clone(&proc.initialized),
        )
    };

    let (tx, rx) = std_mpsc::channel::<serde_json::Value>();
    pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id, tx);

    let write_result = {
        let stdin_arc = Arc::clone(&stdin_arc);
        let line_bytes = line.into_bytes();
        tokio::task::spawn_blocking(move || {
            let mut stdin = stdin_arc.lock().unwrap_or_else(|e| e.into_inner());
            stdin.write_all(&line_bytes).and_then(|_| stdin.flush())
        })
        .await
        .map_err(|e| format!("MCP write task join error: {}", e))?
    };

    if let Err(e) = write_result {
        pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        return Err(format!(
            "MCP write error: {}{}",
            e,
            process_output_detail(&stderr_tail)
        ));
    }

    let recv_result =
        tokio::task::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(30)))
            .await
            .map_err(|e| format!("MCP task join error: {}", e))?;

    let response = match recv_result {
        Ok(response) => response,
        Err(_) => {
            pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err(format!(
                "MCP call '{}' timed out after 30s{}",
                method,
                process_output_detail(&stderr_tail)
            ));
        }
    };

    if let Some(err) = response.get("error") {
        let message = err
            .get("message")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| err.to_string());
        return Err(format!(
            "MCP error: {}{}",
            message,
            process_output_detail(&stderr_tail)
        ));
    }

    if method == "initialize" {
        *initialized.lock().unwrap_or_else(|e| e.into_inner()) = true;
    }

    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
fn mcp_kill(server_id: String) -> Result<(), String> {
    let removed = MCP_PROCESSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&server_id);
    drop(removed);
    Ok(())
}

#[tauri::command]
fn mcp_list_running() -> Vec<String> {
    MCP_PROCESSES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .keys()
        .cloned()
        .collect()
}

#[tauri::command]
fn mcp_process_state(server_id: String) -> McpProcessState {
    let procs = MCP_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(proc) = procs.get(&server_id) {
        return McpProcessState {
            running: true,
            initialized: *proc.initialized.lock().unwrap_or_else(|e| e.into_inner()),
        };
    }
    McpProcessState {
        running: false,
        initialized: false,
    }
}

#[tauri::command]
async fn tool_fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Meridian/1.0)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch error: {}", e))?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| format!("read error: {}", e))?;

    Ok(format!("HTTP {}\n{}", status, text))
}


fn roblox_mcp_config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA env var not set".to_string())?;
        Ok(PathBuf::from(local_app_data)
            .join("Roblox")
            .join("MCP.json"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
        Ok(PathBuf::from(home)
            .join(".config")
            .join("Roblox")
            .join("MCP.json"))
    }
}

#[derive(Clone, Serialize)]
struct RobloxMcpLaunch {
    command: String,
    args: Vec<String>,
    #[serde(rename = "mcpBatPath")]
    mcp_bat_path: String,
    #[serde(rename = "studioMcpPath")]
    studio_mcp_path: Option<String>,
    #[serde(rename = "configPath")]
    config_path: String,
    #[serde(rename = "mcpBatExists")]
    mcp_bat_exists: bool,
}

fn roblox_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA env var not set".to_string())?;
        Ok(PathBuf::from(local_app_data).join("Roblox"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
        Ok(PathBuf::from(home).join(".config").join("Roblox"))
    }
}

fn roblox_mcp_bat_path() -> Result<PathBuf, String> {
    Ok(roblox_dir()?.join("mcp.bat"))
}

fn find_roblox_studio_mcp_exe() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let versions_dir = roblox_dir()?.join("Versions");
        let entries = fs::read_dir(&versions_dir).map_err(|e| {
            format!(
                "Failed to read Roblox versions directory {}: {}",
                versions_dir.display(),
                e
            )
        })?;

        let mut best: Option<(u64, PathBuf)> = None;
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let exe = dir.join("StudioMCP.exe");
            if !exe.exists() {
                continue;
            }
            let modified = fs::metadata(&exe)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if best.as_ref().map(|(ts, _)| modified > *ts).unwrap_or(true) {
                best = Some((modified, exe));
            }
        }

        best.map(|(_, path)| path).ok_or_else(|| {
            format!(
                "Roblox Studio MCP launcher was not found under {}. Update or open Roblox Studio once, then try again.",
                versions_dir.display()
            )
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Automatic Roblox Studio MCP discovery is only implemented on Windows".to_string())
    }
}

fn write_roblox_mcp_bat(studio_mcp_path: &Path, mcp_bat_path: &Path) -> Result<(), String> {
    if let Some(parent) = mcp_bat_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Roblox config dir: {}", e))?;
    }
    let bat = format!(
        "@echo off\r\n\"{}\" --stdio %*\r\n",
        studio_mcp_path.to_string_lossy()
    );
    fs::write(mcp_bat_path, bat).map_err(|e| {
        format!(
            "Failed to write Roblox MCP launcher {}: {}",
            mcp_bat_path.display(),
            e
        )
    })
}

fn resolve_roblox_mcp_launch(write_missing_bat: bool) -> Result<RobloxMcpLaunch, String> {
    let config_path = roblox_mcp_config_path()?;
    let mcp_bat_path = roblox_mcp_bat_path()?;
    let studio_mcp_path = find_roblox_studio_mcp_exe().ok();

    if write_missing_bat && !mcp_bat_path.exists() {
        let studio = studio_mcp_path.as_ref().ok_or_else(|| {
            "Roblox Studio MCP launcher was not found. Update or open Roblox Studio once, then try again.".to_string()
        })?;
        write_roblox_mcp_bat(studio, &mcp_bat_path)?;
    }

    if let Some(studio) = studio_mcp_path {
        return Ok(RobloxMcpLaunch {
            command: studio.to_string_lossy().to_string(),
            args: vec!["--stdio".to_string()],
            mcp_bat_path: mcp_bat_path.to_string_lossy().to_string(),
            studio_mcp_path: Some(studio.to_string_lossy().to_string()),
            config_path: config_path.to_string_lossy().to_string(),
            mcp_bat_exists: mcp_bat_path.exists(),
        });
    }

    if mcp_bat_path.exists() {
        return Ok(RobloxMcpLaunch {
            command: "cmd.exe".to_string(),
            args: vec!["/c".to_string(), mcp_bat_path.to_string_lossy().to_string()],
            mcp_bat_path: mcp_bat_path.to_string_lossy().to_string(),
            studio_mcp_path: None,
            config_path: config_path.to_string_lossy().to_string(),
            mcp_bat_exists: true,
        });
    }

    Err(format!(
        "Roblox Studio MCP launcher is missing. Expected {} or StudioMCP.exe in the Roblox Versions folder. Update or open Roblox Studio once, then try again.",
        mcp_bat_path.display()
    ))
}

#[tauri::command]
fn roblox_mcp_launch_info() -> Result<RobloxMcpLaunch, String> {
    resolve_roblox_mcp_launch(false)
}

#[tauri::command]
fn write_roblox_mcp_config() -> Result<String, String> {
    let config_path = roblox_mcp_config_path()?;
    let launch = resolve_roblox_mcp_launch(true)?;

    let config_json = serde_json::json!({
        "mcpServers": {
            "Roblox_Studio": {
                "command": "cmd.exe",
                "args": ["/c", launch.mcp_bat_path]
            }
        }
    });

    let json_str = serde_json::to_string_pretty(&config_json)
        .map_err(|e| format!("JSON serialize error: {}", e))?;

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Roblox config dir: {}", e))?;
    }

    fs::write(&config_path, &json_str).map_err(|e| {
        format!(
            "Failed to write Roblox MCP config to {}: {}",
            config_path.display(),
            e
        )
    })?;

    Ok(config_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_roblox_mcp_config() -> Result<String, String> {
    let config_path = roblox_mcp_config_path()?;
    if !config_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&config_path).map_err(|e| format!("Failed to read Roblox MCP config: {}", e))
}



#[tauri::command]
async fn tool_count_lines(path: String, base_dir: Option<String>) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		let content = fs::read_to_string(&resolved)
			.map_err(|e| format!("count_lines error for {}: {}", resolved.display(), e))?;
		let count = content.lines().count();
		Ok(format!("{} lines in {}", count, resolved.display()))
	})
	.await
	.map_err(|e| format!("count_lines join error: {}", e))?
}

#[tauri::command]
async fn tool_replace_all_in_file(
	path: String,
	find: String,
	replace: String,
	base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let resolved = resolve_path(&path, base_dir.as_deref())?;
		let raw = fs::read_to_string(&resolved)
			.map_err(|e| format!("read error for {}: {}", resolved.display(), e))?;
		let uses_crlf = raw.contains("\r\n");
		let content = raw.replace("\r\n", "\n");
		let find_lf = find.replace("\r\n", "\n");
		let replace_lf = replace.replace("\r\n", "\n");
		let count = content.matches(&*find_lf).count();
		if count == 0 {
			return Err(format!("String not found in {}", resolved.display()));
		}
		let new_lf = content.replace(&*find_lf, &replace_lf);
		let new_content = if uses_crlf {
			new_lf.replace('\n', "\r\n")
		} else {
			new_lf
		};
		fs::write(&resolved, &new_content)
			.map_err(|e| format!("write error for {}: {}", resolved.display(), e))?;
		Ok(format!(
			"Replaced {} occurrence(s) in {}",
			count,
			resolved.display()
		))
	})
	.await
	.map_err(|e| format!("replace_all_in_file join error: {}", e))?
}

#[tauri::command]
async fn tool_read_multiple_files(
	paths: Vec<String>,
	base_dir: Option<String>,
) -> Result<String, String> {
	tokio::task::spawn_blocking(move || {
		let mut result = String::new();
		for path in &paths {
			let resolved = resolve_path(path, base_dir.as_deref())
				.unwrap_or_else(|_| std::path::PathBuf::from(path));
			match fs::read_to_string(&resolved) {
				Ok(content) => {
					result.push_str(&format!("=== {} ===\n{}\n\n", resolved.display(), content));
				}
				Err(e) => {
					result.push_str(&format!("=== {} === ERROR: {}\n\n", resolved.display(), e));
				}
			}
		}
		Ok(result)
	})
	.await
	.map_err(|e| format!("read_multiple_files join error: {}", e))?
}

#[tauri::command]
fn tool_get_env(key: String) -> Result<String, String> {
    std::env::var(&key).map_err(|_| format!("Environment variable '{}' not set", key))
}

#[tauri::command]
fn tool_path_type(path: String, base_dir: Option<String>) -> Result<String, String> {
    let resolved = resolve_path(&path, base_dir.as_deref())?;
    if !resolved.exists() {
        return Ok("not_found".to_string());
    }
    if resolved.is_dir() {
        return Ok("directory".to_string());
    }
    if resolved.is_file() {
        return Ok("file".to_string());
    }
    Ok("other".to_string())
}

#[tauri::command]
fn tool_get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}


fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
	fs::create_dir_all(dst).map_err(|e| format!("create_dir {}: {}", dst.display(), e))?;
	for entry in fs::read_dir(src).map_err(|e| format!("read_dir {}: {}", src.display(), e))? {
		let entry = entry.map_err(|e| e.to_string())?;
		let ft = entry.file_type().map_err(|e| e.to_string())?;
		let from = entry.path();
		let to = dst.join(entry.file_name());
		if ft.is_dir() {
			copy_dir_recursive(&from, &to)?;
		} else if ft.is_file() {
			fs::copy(&from, &to).map_err(|e| format!("copy {} -> {}: {}", from.display(), to.display(), e))?;
		}
	}
	Ok(())
}

fn validate_skill_dir(dir: &Path) -> Result<String, String> {
	if !dir.is_dir() {
		return Err(format!("Not a directory: {}", dir.display()));
	}
	let skill_md = dir.join("SKILL.md");
	if !skill_md.is_file() {
		return Err("Missing SKILL.md in selected folder".to_string());
	}
	let content = fs::read_to_string(&skill_md)
		.map_err(|e| format!("Could not read SKILL.md: {}", e))?;
	let trimmed = content.trim_start();
	if !trimmed.starts_with("---") {
		return Err("SKILL.md must start with YAML frontmatter (---)".to_string());
	}
	let after_first = &trimmed[3..];
	let end = after_first
		.find("\n---")
		.ok_or_else(|| "SKILL.md frontmatter is not closed with ---".to_string())?;
	let front = &after_first[..end];

	let mut name: Option<String> = None;
	let mut has_desc = false;
	for line in front.lines() {
		let line = line.trim();
		if let Some(rest) = line.strip_prefix("name:") {
			name = Some(rest.trim().trim_matches(|c| c == '"' || c == '\'').to_string());
		} else if line.starts_with("description:") {
			has_desc = true;
		}
	}
	let name = name.ok_or_else(|| "SKILL.md frontmatter missing 'name:' field".to_string())?;
	if name.is_empty() {
		return Err("SKILL.md 'name:' field is empty".to_string());
	}
	if !has_desc {
		return Err("SKILL.md frontmatter missing 'description:' field".to_string());
	}
	if name.contains('/') || name.contains('\\') || name.contains("..") {
		return Err(format!("Invalid skill name: {}", name));
	}
	Ok(name)
}

#[tauri::command]
async fn ensure_default_skills(
	app: AppHandle,
	target_root: String,
	overwrite: Option<bool>,
) -> Result<Vec<String>, String> {
	use tauri::Manager;
	let resource_dir = app
		.path()
		.resource_dir()
		.map_err(|e| format!("Could not locate resource dir: {}", e))?;
	let bundled_skills = resource_dir.join("skills");

	tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
		if !bundled_skills.is_dir() {
			return Ok(Vec::new());
		}
		let target = PathBuf::from(&target_root);
		fs::create_dir_all(&target).map_err(|e| format!("create target {}: {}", target.display(), e))?;

		let mut copied = Vec::new();
		for entry in fs::read_dir(&bundled_skills)
			.map_err(|e| format!("read bundled skills: {}", e))?
		{
			let entry = entry.map_err(|e| e.to_string())?;
			if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
				continue;
			}
			let name = entry.file_name().to_string_lossy().to_string();
			let dest = target.join(&name);
			if dest.exists() && !overwrite.unwrap_or(false) {
				continue;
			}
			if dest.exists() {
				fs::remove_dir_all(&dest)
					.map_err(|e| format!("remove existing {}: {}", dest.display(), e))?;
			}
			copy_dir_recursive(&entry.path(), &dest)?;
			copied.push(name);
		}
		Ok(copied)
	})
	.await
	.map_err(|e| format!("ensure_default_skills join error: {}", e))?
}

#[tauri::command]
async fn import_skill(source_dir: String, target_root: String) -> Result<String, String> {
	tokio::task::spawn_blocking(move || -> Result<String, String> {
		let src = PathBuf::from(&source_dir);
		let name = validate_skill_dir(&src)?;
		let target = PathBuf::from(&target_root);
		fs::create_dir_all(&target).map_err(|e| format!("create target: {}", e))?;
		let dest = target.join(&name);
		if dest.exists() {
			return Err(format!("Skill '{}' already exists. Delete it first to re-import.", name));
		}
		copy_dir_recursive(&src, &dest)?;
		Ok(name)
	})
	.await
	.map_err(|e| format!("import_skill join error: {}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            browser_open_login,
chat_stream,
            save_provider_key,
            provider_connections,
            provider_models,
            chat_stream_vision,
            tool_read_file,
            tool_write_file,
            tool_append_file,
            tool_create_directory,
            tool_copy_file,
            tool_move_file,
            tool_file_exists,
            tool_file_info,
            tool_read_file_range,
            tool_delete_file,
            tool_list_directory,
            tool_search_files,
            tool_edit_file,
            tool_run_command,
            codex_cli_run,
            tool_fetch_url,
            tool_read_uploaded_file,
            select_directory,
            download_and_run_update,
            download_and_run_installer,
            get_app_version,
            chat_merge,
            chat_surf,
            mcp_spawn,
            mcp_notify,
            mcp_call,
            mcp_kill,
            mcp_list_running,
            mcp_process_state,
            roblox_mcp_launch_info,
            write_roblox_mcp_config,
            read_roblox_mcp_config,
            tool_count_lines,
            tool_replace_all_in_file,
            tool_read_multiple_files,
            tool_get_env,
            tool_path_type,
tool_get_cwd,
            ensure_default_skills,
            import_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
