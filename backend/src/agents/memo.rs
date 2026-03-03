/// Memo Agent — Opus
/// Synthesizes findings into a one-paragraph judicial summary.
/// Neutral, precise, judicial register — written for a judge with 40 motions.
use anyhow::Result;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus, ValidationResult, Verdict};

const SYSTEM: &str = r#"You are drafting a bench memo for a federal judge reviewing a motion. Write in a neutral, precise judicial register. Be concise — the judge has 40 motions this week. Do not predict the outcome. Do not recommend a decision. Your role is to surface the key issues clearly.

The memo should cover in one paragraph:
1. What the motion argues
2. The most significant citation issues found
3. The most significant factual inconsistency found
4. The key legal question the court must resolve

Return ONLY the paragraph text — no JSON, no headers, no preamble."#;

pub async fn write_memo(
    llm: &LlmClient,
    msj_text: &str,
    validation_results: &[ValidationResult],
    consistency_flags: &[ConsistencyFlag],
) -> Result<String> {
    let flagged_citations: Vec<String> = validation_results
        .iter()
        .filter(|v| !matches!(v.verdict, Verdict::Verified))
        .map(|v| {
            format!(
                "- {} → {:?} ({})",
                v.citation_string,
                v.verdict,
                v.flags.first().cloned().unwrap_or_default()
            )
        })
        .collect();

    let contradictions: Vec<String> = consistency_flags
        .iter()
        .filter(|f| matches!(f.status, ConsistencyStatus::Contradicted))
        .map(|f| format!("- {}: {}", f.sumf_assertion, f.detail))
        .collect();

    let user = format!(
        r#"Motion summary (first 1500 chars):
{}

Citation issues identified:
{}

Factual contradictions in SUMF:
{}

Write a one-paragraph bench memo for the reviewing judge."#,
        &msj_text[..msj_text.len().min(1500)],
        if flagged_citations.is_empty() {
            "None identified".to_string()
        } else {
            flagged_citations.join("\n")
        },
        if contradictions.is_empty() {
            "None identified".to_string()
        } else {
            contradictions.join("\n")
        }
    );

    llm.call(MODEL_OPUS, SYSTEM, &user, 800).await
}
