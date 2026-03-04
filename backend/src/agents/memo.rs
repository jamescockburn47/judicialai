/// Memo Agent — Opus
/// Synthesizes findings into a structured judicial report with clear sections.
/// Written for a judge: neutral, precise, exportable.
use anyhow::Result;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus, ValidationResult, Verdict};

const SYSTEM: &str = r#"You are a senior judicial law clerk drafting a bench memo for a judge who will rule on a motion for summary judgment. Write in a neutral, precise judicial register. Do not predict the outcome. Do not recommend a decision.

You must produce a structured memo with the following clearly labelled sections. Each section should be substantive — this is not a summary, it is a working document for the judge.

SECTIONS REQUIRED:
1. MOTION — What the movant argues and the legal standards invoked
2. CITATION ANALYSIS — For each flagged citation: what the motion claims, what the case actually holds (or why it appears fabricated), and the significance to the argument
3. FACTUAL RECORD — Where the SUMF is contradicted or unsupported by the record documents, with specific references
4. KEY LEGAL QUESTIONS — The 2-3 questions the court must resolve to rule on this motion
5. PROCEDURAL NOTE — Any procedural issues (timing, jurisdiction, standing) worth flagging

Format each section with its heading in ALL CAPS followed by a colon. Write in complete sentences. Be specific — cite the case names and SUMF paragraph numbers where relevant."#;

pub async fn write_memo(
    llm: &LlmClient,
    msj_text: &str,
    validation_results: &[ValidationResult],
    consistency_flags: &[ConsistencyFlag],
) -> Result<String> {
    let flagged: Vec<String> = validation_results
        .iter()
        .filter(|v| !matches!(v.verdict, Verdict::Verified))
        .map(|v| {
            format!(
                "Citation: {}\nVerdict: {:?} (confidence: {:?})\nProposition claimed: {}\nReasoning: {}\nFlags: {}",
                v.citation_string,
                v.verdict,
                v.confidence,
                v.proposition,
                v.reasoning,
                v.flags.join("; ")
            )
        })
        .collect();

    let contradictions: Vec<String> = consistency_flags
        .iter()
        .filter(|f| !matches!(f.status, ConsistencyStatus::Supported))
        .map(|f| {
            format!(
                "SUMF assertion: {}\nStatus: {:?}\nContradicted by: {}\nDetail: {}",
                f.sumf_assertion,
                f.status,
                f.contradicted_by.join(", "),
                f.detail
            )
        })
        .collect();

    let user = format!(
        r#"MOTION TEXT:
{}

CITATION ISSUES IDENTIFIED BY PIPELINE:
{}

FACTUAL RECORD ISSUES:
{}

Draft a structured bench memo covering all required sections."#,
        &msj_text[..msj_text.len().min(3000)],
        if flagged.is_empty() {
            "No citation issues identified.".to_string()
        } else {
            flagged.join("\n\n---\n\n")
        },
        if contradictions.is_empty() {
            "No factual contradictions identified.".to_string()
        } else {
            contradictions.join("\n\n---\n\n")
        }
    );

    llm.call(MODEL_OPUS, SYSTEM, &user, 2500).await
}
