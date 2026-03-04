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

CRITICAL SIGNALS:
- cite_count = 0 with no case text AND status = not_found: very strong indicator of fabrication. A case used in a brief almost always appears somewhere in citation databases. No case text + zero citations + not found = likely fabricated.
- cite_count > 50: well-established case, existence verified
- status = not_indexed: this case is in a reporter series (e.g. Cal.App.4th, N.Y.S.3d) that is NOT indexed in CourtListener's free database. This is NOT a fabrication signal — these are legitimate published decisions. Use your training knowledge of the case and jurisdiction to assess whether the proposition is plausible.
- Case text retrieved: assess whether the proposition and any quote match the actual text

Your verdicts:
- VERIFIED: Case exists, supports the stated proposition, any quote is accurate
- SUSPECT: Case exists but proposition overstated, taken out of context, or quote modified (e.g. "never" added to conditional holding)
- MISUSED: Case is real but holds something materially different from the claimed proposition — doctrinal transplant
- FABRICATED: Case does not appear to exist in any verified legal database (status=not_found, cite_count=0, no text, implausible details)
- UNVERIFIABLE: Cannot assess from available information — be explicit about WHY and what additional verification would require

For not_indexed cases: assess plausibility from (1) your training knowledge of the case if you recognise it, (2) whether the proposition is consistent with the jurisdiction's established law, (3) whether the citation details (year, court, reporter volume/page) are internally consistent. Do not default to UNVERIFIABLE simply because no text was retrieved — make an assessment and explain it.

For quote accuracy: if quoted text is provided, search for it verbatim in the case text. Flag any word omissions, substitutions, or additions — including absolute words like "never" or "always" that overstate a conditional holding.

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
            crate::types::RetrievalStatus::Resolved => "Found and retrieved".to_string(),
            crate::types::RetrievalStatus::NotFound => format!(
                "NOT FOUND in CourtListener (cite_count={}). This is a potential fabrication signal — a real case used in a brief almost always appears somewhere in citation databases.",
                r.cite_count.unwrap_or(0)
            ),
            crate::types::RetrievalStatus::NotIndexed => format!(
                "Not indexed in CourtListener (reporter: {} — state court decisions in this reporter series are not in CourtListener's free index). This is NOT a fabrication signal. Assess plausibility from the citation details, year, court, and whether the proposition is consistent with the jurisdiction's law.",
                r.citation_id // will be replaced with reporter below
            ),
            crate::types::RetrievalStatus::Error(e) => format!("Retrieval error: {}", e),
        };
        format!(
            "Status: {}\nSource: {} | Title: {} | Court: {} | Date: {} | Cite count in graph: {} | URL: {}",
            status_note,
            r.source,
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
