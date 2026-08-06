const fs = require("fs");
const p = "src-tauri/src/lib.rs";
let s = fs.readFileSync(p, "utf8");
const norm = s.replace(/\r\n/g, "\n");

const findStr = `#[tauri::command]
async fn chat_surf(query: String) -> Result<SearchResponse, String> {
    let client = reqwest::Client::new();
    let api_key = "ua_RNBRNGnm3MLx4VRzSjJtcb1pvwF9gALz";`;

const replaceStr = `async fn surf_grounded_call(client: &reqwest::Client, query: &str) -> Result<SearchResponse, String> {
    let api_key = "ua_RNBRNGnm3MLx4VRzSjJtcb1pvwF9gALz";
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

async fn surf_synthesis_call(client: &reqwest::Client, query: &str, sources: &[SearchResult]) -> Result<String, String> {
    let mut context = String::from("Web search results for the query:\\n\\n");
    for (i, s) in sources.iter().take(8).enumerate() {
        context.push_str(&format!("[{}] {}\\nURL: {}\\nSnippet: {}\\n\\n", i + 1, s.title, s.url, s.snippet));
    }
    let prompt = format!(
        "{}\\n\\nUsing only the above sources, answer this question thoroughly: {}\\n\\nCite sources inline as [1], [2], etc.",
        context, query
    );
    let body = serde_json::json!({
        "model": "claude-opus-4-8",
        "messages": [{ "role": "user", "content": prompt }],
        "stream": false
    });
    let res = client
        .post(format!("{}/v1/chat/completions", WMAN_BASE))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("synthesis request failed: {}", e))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("synthesis read failed: {}", e))?;
    if !status.is_success() {
        return Err(format!("synthesis {}: {}", status, &text[..text.len().min(200)]));
    }
    let val: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("synthesis parse failed: {}", e))?;
    val.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "synthesis: no content".to_string())
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
        "status": format!("Got {} sources, synthesizing with opus 4.8...", grounded.sources.len()),
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
                "Two answers to the question: \\\"{}\\\"\\n\\n=== Answer A (gemini-3-flash with web grounding) ===\\n{}\\n\\n=== Answer B (opus 4.8 synthesis over same sources) ===\\n{}\\n\\nWhich is more accurate, thorough, and well-cited? Reply with ONLY 'A' or 'B' on the first line.",
                query, grounded.answer, syn
            );
            let pick_body = serde_json::json!({
                "model": "claude-opus-4-8",
                "messages": [{ "role": "user", "content": judge_prompt }],
                "stream": false
            });
            let pick = client
                .post(format!("{}/v1/chat/completions", WMAN_BASE))
                .header("content-type", "application/json")
                .json(&pick_body)
                .send()
                .await
                .ok()
                .and_then(|r| futures::executor::block_on(r.text()).ok())
                .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                .and_then(|v| v.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("message")).and_then(|m| m.get("content")).and_then(|s| s.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| "A".to_string());
            let pick_b = pick.trim().to_uppercase().starts_with('B');
            let _ = app.emit("surf://status", serde_json::json!({
                "status": if pick_b { "opus 4.8 synthesis won" } else { "gemini grounded won" },
                "phase": "winner",
                "winner": if pick_b { "synthesis" } else { "grounded" }
            }));
            if pick_b { syn } else { grounded.answer.clone() }
        }
        _ => grounded.answer.clone()
    };

    Ok(SearchResponse { answer: final_answer, sources: grounded.sources })
}

#[allow(dead_code)]
async fn _chat_surf_legacy(query: String) -> Result<SearchResponse, String> {
    let client = reqwest::Client::new();
    let api_key = "ua_RNBRNGnm3MLx4VRzSjJtcb1pvwF9gALz";`;

if (!norm.includes(findStr)) {
	console.error("find not matched");
	process.exit(1);
}
const patched = norm.replace(findStr, replaceStr);
const final_ = patched.replace(/\n/g, "\r\n");
fs.writeFileSync(p, final_);
console.log("patched, +" + (final_.length - s.length) + " bytes");