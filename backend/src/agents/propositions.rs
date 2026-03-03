/// Proposition Extractor — Sonnet claude-sonnet-4-5
/// For each approved citation, reads the MSJ and extracts the exact
/// proposition the motion claims the case supports, plus any direct quote.
use anyhow::Result;
use serde::Deserialize;

use crate::llm::{LlmClient, MODEL_SONNET};
use crate::types::{ApprovedCitation, CitationProposition};

const SYSTEM: &str = r#"You are a precise legal analyst. Your task is to read a Motion for Summary Judgment and identify exactly what proposition each cited case is used to support.

For each citation you are given:
1. Find the sentence(s) in the motion that introduce or rely on that citation.
2. State the proposition claimed — what the motion asserts the case holds or stands for.
3. Identify if there is a direct quote from the case (text in quotation marks attributed to the case).
4. Note which section of the argument the citation appears in.

Return ONLY valid JSON. No explanation outside the JSON."#;

#[derive(Debug, Deserialize)]
struct PropositionOutput {
    citation_id: String,
    proposition: String,
    has_direct_quote: bool,
    quoted_text: Option<String>,
    argument_section: String,
}

pub async fn extract_propositions(
    llm: &LlmClient,
    msj_text: &str,
    approved: &[ApprovedCitation],
) -> Result<Vec<CitationProposition>> {
    let citations_list: Vec<String> = approved
        .iter()
        .map(|a| {
            format!(
                r#"{{ "id": "{}", "citation": "{}" }}"#,
                a.citation.id, a.citation.citation_string
            )
        })
        .collect();

    let user = format!(
        r#"Here is the Motion for Summary Judgment:

<MSJ>
{}
</MSJ>

For each of the following citations, extract the proposition and any direct quote as described:

{}

Return a JSON array with one object per citation:
[
  {{
    "citation_id": "<id>",
    "proposition": "<what the motion claims this case holds>",
    "has_direct_quote": true | false,
    "quoted_text": "<the quoted text, or null>",
    "argument_section": "<e.g. Section III.A — Privette Doctrine>"
  }},
  ...
]"#,
        msj_text,
        serde_json::to_string_pretty(&citations_list)?
    );

    let raw = llm.call_json(MODEL_SONNET, SYSTEM, &user, 2048).await?;
    let outputs: Vec<PropositionOutput> = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("Failed to parse proposition JSON: {}\nRaw: {}", e, raw))?;

    Ok(outputs
        .into_iter()
        .map(|o| CitationProposition {
            citation_id: o.citation_id,
            proposition: o.proposition,
            has_direct_quote: o.has_direct_quote,
            quoted_text: o.quoted_text,
            argument_section: o.argument_section,
        })
        .collect())
}
