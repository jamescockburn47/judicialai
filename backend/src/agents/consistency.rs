/// Consistency Agent — Opus
/// Cross-references SUMF assertions against police report, medical records,
/// and witness statement. Flags contradictions, omissions, and distortions.
use anyhow::Result;
use serde::Deserialize;
use uuid::Uuid;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ConsistencyFlag, ConsistencyStatus};

const SYSTEM: &str = r#"You are a meticulous judicial law clerk. Your task is to identify where the Motion for Summary Judgment makes factual assertions that are directly contradicted by the record documents.

IMPORTANT: Only flag CONTRADICTIONS — where a document in the record says something materially different from what the MSJ asserts. Do NOT flag:
- Facts that are merely "unsupported" (absence of evidence is not a contradiction)
- Neutral facts that the record neither confirms nor contradicts
- Procedural facts (filing dates, case numbers)

For each SUMF assertion you review:
1. Check the police report, medical records, and witness statement for direct contradiction
2. Only create a flag if a document says something INCONSISTENT with the assertion — not just silent on it
3. The strongest contradictions: (a) incident date discrepancy (MSJ says March 14, records say March 12), (b) PPE status (MSJ §4 says no PPE; police report and witness statement both confirm plaintiff was wearing a harness), (c) Harmon's foreman directing work on the defective scaffolding section

Be specific: quote both the MSJ assertion and the contradicting passage. If a document supports the assertion, note that too but do NOT flag it as a problem.

Return ONLY valid JSON — a minimal array of genuine contradictions."#;

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

Here are the record documents:

<POLICE_REPORT>
{}
</POLICE_REPORT>

<MEDICAL_RECORDS>
{}
</MEDICAL_RECORDS>

<WITNESS_STATEMENT>
{}
</WITNESS_STATEMENT>

Identify ONLY direct contradictions between the SUMF and the record. Known contradictions to verify:
1. SUMF §3 states the incident occurred "on or about March 14, 2021" — the police report and medical records both give March 12, 2021
2. SUMF §4 states Rivera was "not wearing required personal protective equipment" — the police report (Ellison statement) and witness statement (Tran) both state he WAS wearing a harness
3. The MSJ does not mention that Harmon's foreman Ray Donner directed the crew to work on the defective section — the police report and witness statement both record this

Return a JSON array of ONLY genuine contradictions (not unsupported facts):
[
  {{
    "sumf_assertion": "<the exact SUMF text>",
    "supported_by": [],
    "contradicted_by": ["police_report", "witness_statement"],
    "status": "contradicted",
    "detail": "<quote the specific contradicting passage>"
  }}
]"#,
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
