/// Validator Agent — Opus
/// Fed: MSJ proposition + approved retrieved case full text.
/// Outputs verdict, confidence, reasoning, quote accuracy.
use anyhow::Result;
use serde::Deserialize;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{
    ApprovedCitation, CitationProposition, ConfidenceLevel, ValidationResult, Verdict,
};

const SYSTEM: &str = r#"You are a rigorous legal citation verifier assisting a federal judge. Your task is to determine whether a cited case (1) exists, (2) actually says what the brief claims, and (3) whether any direct quote is accurate.

You will be given:
1. The proposition as stated in the motion
2. Any direct quote attributed to the case
3. Retrieved case information: full text (if available), title, cite count
4. The cite_count: number of times this case appears in CourtListener's citation graph

CRITICAL RULES:
1. FABRICATED: status=not_found, cite_count=0. Case was actively searched and not found. Use this verdict.
2. UNVERIFIABLE (proposition): status=resolved_no_text. Case CONFIRMED TO EXIST but no text to check the proposition against. You must say: "Case confirmed to exist (cite_count=N) but full text not retrieved — proposition cannot be verified from available sources." Do NOT guess what the case holds.
3. VERIFIED/SUSPECT/MISUSED: only when full text is in the CASE_TEXT section below. Assess the proposition against the actual retrieved text.
4. Do NOT use training knowledge to assess what a case holds. Only the retrieved text counts for proposition verification.
5. For quote accuracy: search the case text character by character. Any word not in the retrieved text must be flagged.

Your verdicts:
- FABRICATED: not_found, cite_count=0, no text — case does not appear to exist
- UNVERIFIABLE: case found (cite_count>0) but text not retrieved, OR retrieval failed — cannot assess proposition
- VERIFIED: full text retrieved, proposition accurate, quote accurate
- SUSPECT: full text retrieved, proposition overstated/out of context/quote modified
- MISUSED: full text retrieved, case holds something materially different

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
        .unwrap_or("[Case text not retrieved]");

    let retrieval_info = approved.retrieved_case.as_ref().map(|r| {
        let status_note = match &r.status {
            crate::types::RetrievalStatus::Resolved => format!(
                "FOUND — full text retrieved ({} chars). Validate proposition against this text.",
                r.full_text.as_deref().map(|t| t.len()).unwrap_or(0)
            ),
            crate::types::RetrievalStatus::ResolvedNoText => format!(
                "FOUND in CourtListener (cite_count={}) but full text not available. \
                 You CAN confirm the case exists. You CANNOT verify the proposition or quote — \
                 verdict must be UNVERIFIABLE for the proposition aspect. \
                 Clearly state: case confirmed to exist, proposition unverifiable without text.",
                r.cite_count.unwrap_or(0)
            ),
            crate::types::RetrievalStatus::NotFound => format!(
                "NOT FOUND — searched CourtListener by citation lookup, case name, and quoted citation. \
                 cite_count={}. A real case used in a brief almost always appears in citation databases. \
                 This is a strong fabrication signal.",
                r.cite_count.unwrap_or(0)
            ),
            crate::types::RetrievalStatus::Error(e) => format!("Retrieval error: {}", e),
        };
        format!(
            "Retrieval status: {}\nTitle: {} | Court: {} | Date: {} | Cite count: {} | URL: {}",
            status_note,
            r.title.as_deref().unwrap_or("(unknown)"),
            r.court_name.as_deref().unwrap_or("(unknown)"),
            r.decision_date.as_deref().unwrap_or("(unknown)"),
            r.cite_count.map(|c| c.to_string()).as_deref().unwrap_or("(not retrieved)"),
            r.url
        )
    }).unwrap_or_else(|| "No retrieval data available".to_string());

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

Argument section: {}

Case text (from CourtListener PDF or snippet):
<CASE_TEXT>
{}
</CASE_TEXT>{}

Assess this citation and return JSON in this exact format:
{{
  "verdict": "verified" | "suspect" | "misused" | "fabricated" | "unverifiable",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<detailed analysis, 3-6 sentences. Explicitly mention cite_count if 0>",
  "quote_accurate": true | false | null,
  "quote_analysis": "<analysis of quote accuracy, or null if no quote>",
  "is_structural": true | false,
  "flags": ["<specific issue 1>", ...]
}}"#,
        approved.citation.citation_string,
        retrieval_info,
        proposition.proposition,
        proposition
            .quoted_text
            .as_deref()
            .unwrap_or("[No direct quote]"),
        proposition.argument_section,
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
