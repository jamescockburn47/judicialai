/// Consistency Agent — Opus
/// Cross-references SUMF assertions against police report, medical records,
/// and witness statement. Flags contradictions, omissions, and distortions.
use anyhow::Result;
use serde::Deserialize;
use uuid::Uuid;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus};

const SYSTEM: &str = r#"You are a meticulous judicial law clerk. Your task is to identify where a motion's factual assertions are directly contradicted by the record documents submitted alongside it.

IMPORTANT: Only flag CONTRADICTIONS — where a record document says something materially different from what the motion asserts. Do NOT flag:
- Facts that are merely "unsupported" (absence of evidence is not a contradiction)
- Neutral facts that the record neither confirms nor contradicts
- Procedural facts (filing dates, case numbers)
- Differences in tone or characterisation that do not contradict substance

For each factual assertion in the motion's statement of facts:
1. Check all record documents for direct contradiction
2. Only create a flag if a document says something INCONSISTENT with the assertion — not just silent on it
3. Quote the specific contradicting passage

Return ONLY valid JSON."#;

#[derive(Debug, Deserialize)]
struct ConsistencyOutput {
    sumf_assertion: String,
    supported_by: Vec<String>,
    contradicted_by: Vec<String>,
    status: String,
    detail: String,
}

pub async fn check_consistency(
    llm: &LlmClient,
    msj_text: &str,
    police_report: &str,
    medical_records: &str,
    witness_statement: &str,
) -> Result<Vec<ConsistencyFlag>> {
    let user = format!(
        r#"Here is the primary motion document (focus on the Statement of Undisputed Material Facts or equivalent factual section):

<MOTION>
{}
</MOTION>

Here are the record documents submitted alongside the motion:

<DOCUMENT_1>
{}
</DOCUMENT_1>

<DOCUMENT_2>
{}
</DOCUMENT_2>

<DOCUMENT_3>
{}
</DOCUMENT_3>

Identify ONLY direct contradictions between the factual assertions in the motion and what the record documents actually say.

A contradiction means a record document states something materially different from what the motion asserts — not merely that the record is silent on a fact.

Examples of genuine contradictions:
- Motion says X happened on date A; a record document gives date B
- Motion says a party was not wearing safety equipment; a witness statement or incident report says they were
- Motion omits a material fact that is directly recorded in a contemporaneous document and that affects the legal argument

Do not flag:
- Facts the record does not address (absence ≠ contradiction)
- Procedural or docket facts
- Differences in emphasis or characterisation that do not contradict the substance

Return a JSON array of ONLY genuine contradictions:
[
  {{
    "sumf_assertion": "<exact text of the motion's assertion>",
    "supported_by": [],
    "contradicted_by": ["document_1", "document_2"],
    "status": "contradicted",
    "detail": "<quote the specific contradicting passage from the record document>"
  }}
]

If there are no genuine contradictions, return an empty array []."#,
        msj_text, police_report, medical_records, witness_statement
    );

    let raw = llm.call_json(MODEL_OPUS, SYSTEM, &user, 3000).await?;
    let outputs: Vec<ConsistencyOutput> = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("Failed to parse consistency JSON: {}\nRaw: {}", e, raw))?;

    Ok(outputs
        .into_iter()
        .map(|o| ConsistencyFlag {
            id: Uuid::new_v4().to_string(),
            sumf_assertion: o.sumf_assertion,
            supported_by: o.supported_by,
            contradicted_by: o.contradicted_by,
            status: parse_status(&o.status),
            detail: o.detail,
        })
        .collect())
}

fn parse_status(s: &str) -> ConsistencyStatus {
    match s.to_lowercase().as_str() {
        "supported" => ConsistencyStatus::Supported,
        "contradicted" => ConsistencyStatus::Contradicted,
        "partial" => ConsistencyStatus::Partial,
        _ => ConsistencyStatus::Unsupported,
    }
}
