/// Validator Agent — Opus
/// Fed: MSJ proposition + approved retrieved case full text.
/// Outputs verdict, confidence, reasoning, quote accuracy.
use anyhow::Result;
use serde::Deserialize;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{
    ApprovedCitation, CitationProposition, ConfidenceLevel, ValidationResult, Verdict,
};

const SYSTEM: &str = r#"You are a rigorous legal citation verifier assisting a federal judge. Your task is to determine whether a cited case actually supports the proposition for which it is cited in a motion.

You will be given:
1. The proposition as stated in the motion
2. Any direct quote attributed to the case
3. The full text of the cited case (or a summary if full text is unavailable)

Your analysis must distinguish between:
- VERIFIED: The case clearly supports the stated proposition
- SUSPECT: The case arguably supports the proposition but it is overstated, taken out of context, or relies on dicta
- MISUSED: The case is real but the proposition attributed to it is materially incorrect — the case holds something different
- FABRICATED: The case text is unavailable and/or the combination of case name, citation, and proposition is implausible — likely a hallucinated citation
- UNVERIFIABLE: Insufficient information to assess — case text not retrieved, clearly state what could not be verified

For quote accuracy:
- If a direct quote is present, verify it against the case text character by character. Flag any omissions, substitutions, or embellishments, including the word "never" or similar absolutes that overstate a holding.

Be appropriately uncertain. "Could not verify" is a valid and honest finding. Never fabricate a finding.

Return ONLY valid JSON."#;

#[derive(Debug, Deserialize)]
struct ValidatorOutput {
    verdict: String,
    confidence: String,
    reasoning: String,
    quote_accurate: Option<bool>,
    quote_analysis: Option<String>,
    is_structural: bool,
    flags: Vec<String>,
}

pub async fn validate_citation(
    llm: &LlmClient,
    approved: &ApprovedCitation,
    proposition: &CitationProposition,
    judge_note: Option<&str>,
) -> Result<ValidationResult> {
    let case_text = approved
        .retrieved_case
        .as_ref()
        .and_then(|r| r.full_text.as_deref())
        .unwrap_or("[Case text not retrieved — assess based on citation plausibility only]");

    let retrieval_source = approved
        .retrieved_case
        .as_ref()
        .map(|r| format!("Source: {} | URL: {}", r.source, r.url))
        .unwrap_or_else(|| "No retrieval data available".to_string());

    let judge_note_section = match judge_note {
        Some(note) if !note.is_empty() => format!(
            "\n\n<JUDGE_NOTE>\nThe reviewing judge has flagged this citation with the following concern:\n{}\nPlease address this concern directly in your reasoning.\n</JUDGE_NOTE>",
            note
        ),
        _ => String::new(),
    };

    let user = format!(
        r#"Citation: {}
Retrieval: {}

Proposition claimed in motion: {}

Direct quote in motion: {}

{}

Full case text:
<CASE_TEXT>
{}
</CASE_TEXT>{}

Assess this citation and return JSON in this exact format:
{{
  "verdict": "verified" | "suspect" | "misused" | "fabricated" | "unverifiable",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<detailed analysis, 2-5 sentences>",
  "quote_accurate": true | false | null,
  "quote_analysis": "<analysis of quote accuracy, or null if no quote>",
  "is_structural": true | false,
  "flags": ["<specific issue 1>", "<specific issue 2>", ...]
}}"#,
        approved.citation.citation_string,
        retrieval_source,
        proposition.proposition,
        proposition
            .quoted_text
            .as_deref()
            .unwrap_or("[No direct quote]"),
        format!(
            "Argument section: {}",
            proposition.argument_section
        ),
        case_text,
        judge_note_section
    );

    let raw = llm.call_json(MODEL_OPUS, SYSTEM, &user, 1500).await?;
    let output: ValidatorOutput = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("Failed to parse validator JSON: {}\nRaw: {}", e, raw))?;

    let verdict = parse_verdict(&output.verdict);
    let confidence = parse_confidence(&output.confidence);

    Ok(ValidationResult {
        citation_id: approved.citation.id.clone(),
        citation_string: approved.citation.citation_string.clone(),
        proposition: proposition.proposition.clone(),
        verdict,
        confidence,
        reasoning: output.reasoning,
        quote_accurate: output.quote_accurate,
        quote_analysis: output.quote_analysis,
        is_structural: output.is_structural,
        flags: output.flags,
    })
}

fn parse_verdict(s: &str) -> Verdict {
    match s.to_lowercase().as_str() {
        "verified" => Verdict::Verified,
        "suspect" => Verdict::Suspect,
        "misused" => Verdict::Misused,
        "fabricated" => Verdict::Fabricated,
        _ => Verdict::Unverifiable,
    }
}

fn parse_confidence(s: &str) -> ConfidenceLevel {
    match s.to_lowercase().as_str() {
        "high" => ConfidenceLevel::High,
        "medium" => ConfidenceLevel::Medium,
        _ => ConfidenceLevel::Low,
    }
}
