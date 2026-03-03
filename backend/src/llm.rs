use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::env;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

pub const MODEL_SONNET: &str = "claude-sonnet-4-6";
pub const MODEL_OPUS: &str = "claude-opus-4-6";

#[derive(Debug, Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
    system: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Clone)]
pub struct LlmClient {
    client: reqwest::Client,
    api_key: String,
}

impl LlmClient {
    /// Create from environment variable (used at startup if no per-request key)
    pub fn new() -> Result<Self> {
        let api_key = env::var("ANTHROPIC_API_KEY").unwrap_or_default();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
        Ok(Self { client, api_key })
    }

    /// Create with a specific key (from X-Anthropic-Key header, overrides env var)
    pub fn with_key(key: String) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;
        Ok(Self { client, api_key: key })
    }

    pub fn has_key(&self) -> bool {
        !self.api_key.is_empty()
    }

    pub async fn call(&self, model: &str, system: &str, user: &str, max_tokens: u32) -> Result<String> {
        let request = AnthropicRequest {
            model: model.to_string(),
            max_tokens,
            messages: vec![Message {
                role: "user".to_string(),
                content: user.to_string(),
            }],
            system: Some(system.to_string()),
        };

        let response = self
            .client
            .post(ANTHROPIC_API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow!("Anthropic API error {}: {}", status, body));
        }

        let anthropic_resp: AnthropicResponse = response.json().await?;

        anthropic_resp
            .content
            .into_iter()
            .find(|b| b.block_type == "text")
            .and_then(|b| b.text)
            .ok_or_else(|| anyhow!("No text content in Anthropic response"))
    }

    /// Call expecting strict JSON back. Strips markdown code fences if present.
    pub async fn call_json(&self, model: &str, system: &str, user: &str, max_tokens: u32) -> Result<String> {
        let raw = self.call(model, system, user, max_tokens).await?;
        Ok(strip_json_fences(&raw))
    }
}

fn strip_json_fences(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.starts_with("```") {
        let start = trimmed.find('\n').map(|i| i + 1).unwrap_or(0);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        trimmed[start..end].trim().to_string()
    } else {
        trimmed.to_string()
    }
}
