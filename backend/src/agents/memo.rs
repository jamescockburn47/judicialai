/// Memo Agent — Opus
/// Primary purpose: assess the reliability of the brief as a legal document.
/// Surfaces citation integrity issues first, factual record issues second,
/// legal analysis last. Written for a judge, not as a case summary.
use anyhow::Result;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus, ValidationResult, Verdict};

const SYSTEM: &str = r#"You are a senior judicial law clerk. Your task is to assess the reliability of a submitted brief as a legal document and produce a working bench memo for the judge.

Your PRIMARY concern is citation integrity: does this brief cite law that actually exists, actually says what the brief claims, and actually supports the propositions for which it is cited? Where law cannot be verified using available resources (CourtListener, public databases), you must flag this explicitly — unverifiability is itself a reliability concern, not a clean bill of health.

Structure your memo with these sections in this order:

BRIEF RELIABILITY ASSESSMENT: A direct, plain-English verdict on the overall reliability of the brief's legal citations. How many citations were verified, how many were unverifiable, how many appear fabricated or misused? What is the aggregate effect on the brief's legal foundation? This is the lead section — write it as if you are briefing the judge before argument.

CITATION INTEGRITY: For each problematic citation, state: (1) what the brief claims the case holds; (2) what the case actually holds or why it could not be verified; (3) whether the unresolved citation is structural to the argument or merely decorative; (4) what the judge should know before relying on it.

FACTUAL RECORD ISSUES: Where the Statement of Undisputed Material Facts is contradicted or unsupported by the record documents (police report, medical records, witness statement). Be specific — cite SUMF paragraph numbers and the contradicting document.

EFFECT ON THE BRIEF'S ARGUMENTS: Which of the movant's arguments survive intact if the unreliable citations are disregarded? Which arguments lose their legal foundation? Be direct.

KEY LEGAL QUESTIONS: The 2-3 questions the court must resolve, framed neutrally.

Do not predict the outcome. Do not recommend a decision. Write in complete sentences. Be specific — name cases, paragraph numbers, and documents."#;

pub async fn write_memo(
    llm: &LlmClient,
    msj_text: &str,
    validation_results: &[ValidationResult],
    consistency_flags: &[ConsistencyFlag],
) -> Result<String> {
    // Build a full citation integrity summary
    let total = validation_results.len();
    let verified_count = validation_results.iter().filter(|v| matches!(v.verdict, Verdict::Verified)).count();
    let fabricated: Vec<&ValidationResult> = validation_results.iter().filter(|v| matches!(v.verdict, Verdict::Fabricated)).collect();
    let misused: Vec<&ValidationResult> = validation_results.iter().filter(|v| matches!(v.verdict, Verdict::Misused)).collect();
    let suspect: Vec<&ValidationResult> = validation_results.iter().filter(|v| matches!(v.verdict, Verdict::Suspect)).collect();
    let unverifiable: Vec<&ValidationResult> = validation_results.iter().filter(|v| matches!(v.verdict, Verdict::Unverifiable)).collect();

    let citation_detail: Vec<String> = validation_results
        .iter()
        .map(|v| {
            format!(
                "Citation: {}\nVerdict: {:?} | Confidence: {:?} | Structural: {}\nProposition in brief: {}\nAnalysis: {}\nQuote accurate: {}\nFlags: {}",
                v.citation_string,
                v.verdict,
                v.confidence,
                v.is_structural,
                v.proposition,
                v.reasoning,
                v.quote_accurate.map(|b| if b { "Yes" } else { "No — see analysis" }).unwrap_or("N/A"),
                if v.flags.is_empty() { "None".to_string() } else { v.flags.join("; ") }
            )
        })
        .collect();

    let consistency_detail: Vec<String> = consistency_flags
        .iter()
        .filter(|f| !matches!(f.status, ConsistencyStatus::Supported))
        .map(|f| {
            format!(
                "SUMF assertion: {}\nRecord status: {:?}\nContradicted by: {}\nDetail: {}",
                f.sumf_assertion,
                f.status,
                f.contradicted_by.join(", "),
                f.detail
            )
        })
        .collect();

    let user = format!(
        r#"MOTION TEXT (first 2500 chars):
{motion}

CITATION INTEGRITY SUMMARY:
Total citations: {total}
Verified: {verified} | Fabricated: {fab} | Misused: {mis} | Suspect: {sus} | Unverifiable (not found in public databases): {unver}

DETAILED CITATION ANALYSIS:
{citations}

FACTUAL RECORD ISSUES (SUMF vs. record documents):
{consistency}

Draft the bench memo following the required structure."#,
        motion = &msj_text[..msj_text.len().min(2500)],
        total = total,
        verified = verified_count,
        fab = fabricated.len(),
        mis = misused.len(),
        sus = suspect.len(),
        unver = unverifiable.len(),
        citations = citation_detail.join("\n\n---\n\n"),
        consistency = if consistency_detail.is_empty() {
            "No factual contradictions identified.".to_string()
        } else {
            consistency_detail.join("\n\n---\n\n")
        }
    );

    llm.call(MODEL_OPUS, SYSTEM, &user, 3000).await
}
