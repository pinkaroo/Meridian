const fs = require("fs");
const p = "src-tauri/src/lib.rs";
let s = fs.readFileSync(p, "utf8");
const orig = s;
const normalized = s.replace(/\r\n/g, "\n");

const findStr = `#[tauri::command]
async fn chat_merge(app: AppHandle, message: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({ "message": message });

    let res = client
        .post(format!("{}/api/merge", PROXY))`;

const replaceStr = `const WMAN_BASE: &str = "https://use-ai-production.up.railway.app";
const MERGE_MODELS: &[&str] = &["claude-opus-4-8", "gpt-5-5", "gemini-3-1-pro"];
const JUDGE_MODEL: &str = "claude-opus-4-8";

async fn merge_single_call(client: &reqwest::Client, model: &str, message: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": message }],
        "stream": false
    });
    let res = client
        .post(format!("{}/v1/chat/completions", WMAN_BASE))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("{}: request failed: {}", model, e))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("{}: read failed: {}", model, e))?;
    if !status.is_success() {
        return Err(format!("{}: {} {}", model, status, &text[..text.len().min(200)]));
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
        "You are judging responses from multiple AI models to pick the best one for the user. The user's question was:\\n\\n---\\n"
    );
    judge_prompt.push_str(&message);
    judge_prompt.push_str("\\n---\\n\\nHere are the candidate responses:\\n\\n");
    for (i, (model, text)) in responses.iter().enumerate() {
        judge_prompt.push_str(&format!("=== Response {} (from {}) ===\\n{}\\n\\n", i + 1, model, text));
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

#[allow(dead_code)]
async fn _chat_merge_legacy(app: AppHandle, message: String) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({ "message": message });

    let res = client
        .post(format!("{}/api/merge", PROXY))`;

if (!normalized.includes(findStr)) {
	console.error("FIND NOT FOUND");
	process.exit(1);
}
const patched = normalized.replace(findStr, replaceStr);
const final_ = patched.replace(/\n/g, "\r\n");
fs.writeFileSync(p, final_);
console.log("patched, added", final_.length - orig.length, "bytes");