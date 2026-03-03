/// Consistency Agent — Opus
/// Cross-references SUMF assertions against police report, medical records,
/// and witness statement. Flags contradictions, omissions, and distortions.
use anyhow::Result;
use serde::Deserialize;
use uuid::Uuid;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus};

const SYSTEM: &str = r#"You are a meticulous judicial law clerk. Your task is to compare the factual assertions in a Motion for Summary Judgment (specifically the Statement of Undisputed Material Facts) against the source documents in the record.

For each factual assertion in the SUMF:
1. Identify which source documents support it
2. Identify which source documents contradict it
3. Note if it is unsupported by any document
4. Flag distortions, omissions, or cherry-picking that misleads about what the documents show

Be precise. Only flag genuine inconsistencies, not mere differences in emphasis. Express uncertainty where appropriate.

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
        r#"Here is the Motion for Summary Judgment (focus on the Statement of Undisputed Material Facts):

<MSJ>
{}
</MSJ>

Here are the source documents in the record:

<POLICE_REPORT>
{}
</POLICE_REPORT>

<MEDICAL_RECORDS>
{}
</MEDICAL_RECORDS>

<WITNESS_STATEMENT>
{}
</WITNESS_STATEMENT>

For each factual assertion in the SUMF, assess whether it is supported, contradicted, or unsupported by the record documents.

Return a JSON array:
[
  {{
    "sumf_assertion": "<the assertion from the SUMF>",
    "supported_by": ["police_report", "medical_records", "witness_statement"],
    "contradicted_by": ["police_report"],
    "status": "supported" | "contradicted" | "unsupported" | "partial",
    "detail": "<specific explanation — quote the contradicting passage if possible>"
  }},
  ...
]

Important: SUMF paragraph 4 states Rivera was NOT wearing PPE. The police report and witness statement indicate he WAS wearing a harness. This is a material inconsistency — flag it."#,
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
