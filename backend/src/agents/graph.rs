/// Graph Mapper Agent — Opus
/// Maps argument structure showing where arguments depend on unreliable law.
/// Nodes: legal arguments + citations. Edges: dependencies.
/// Node status reflects whether the argument survives if unreliable citations are removed.
use anyhow::Result;
use serde::Deserialize;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ArgumentEdge, ArgumentGraph, ArgumentNode, NodeType, ValidationResult, Verdict};

const SYSTEM: &str = r#"You are a legal analyst mapping the argument structure of a motion to assess its reliability.

Your task: build a directed graph showing (1) what arguments the motion makes, (2) which citations each argument relies on, and (3) whether each argument's legal foundation remains intact after removing citations that are fabricated, misused, suspect, or unverifiable.

Rules:
- Each top-level legal argument is a node (type: "argument")
- Each citation is a node (type: "citation")  
- A directed edge from argument → citation means the argument cites that authority
- Mark each edge as structural=true if the argument NEEDS that citation to stand, or structural=false if the argument survives without it
- For each argument node, set "survives_without_unreliable": true/false — does this argument have a sound legal basis remaining after removing all non-verified citations?

Return ONLY valid JSON."#;

#[derive(Debug, Deserialize)]
struct GraphOutput {
    nodes: Vec<NodeOutput>,
    edges: Vec<EdgeOutput>,
}

#[derive(Debug, Deserialize)]
struct NodeOutput {
    id: String,
    label: String,
    node_type: String,
    #[serde(default)]
    survives_without_unreliable: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct EdgeOutput {
    from: String,
    to: String,
    structural: bool,
}

pub async fn build_graph(
    llm: &LlmClient,
    msj_text: &str,
    validation_results: &[ValidationResult],
) -> Result<ArgumentGraph> {
    // Build a clear reliability summary for each citation
    let citation_reliability: Vec<String> = validation_results
        .iter()
        .map(|v| {
            let reliable = matches!(v.verdict, Verdict::Verified);
            format!(
                r#"{{ "citation": "{}", "verdict": "{:?}", "reliable": {}, "structural": {} }}"#,
                v.citation_string.replace('"', "'"),
                v.verdict,
                reliable,
                v.is_structural
            )
        })
        .collect();

    let unreliable_count = validation_results.iter()
        .filter(|v| !matches!(v.verdict, Verdict::Verified))
        .count();

    let user = format!(
        r#"MOTION TEXT:
<MSJ>
{msj}
</MSJ>

CITATION RELIABILITY (from prior validation — {unreliable} of {total} citations are not fully verified):
{citations}

Build the argument dependency graph. For each legal argument in the motion, identify which citations it relies on and whether it survives if unreliable citations are removed.

Return JSON:
{{
  "nodes": [
    {{
      "id": "<unique_id>",
      "label": "<short argument or citation label, max 8 words>",
      "node_type": "argument" | "citation",
      "survives_without_unreliable": true | false | null
    }},
    ...
  ],
  "edges": [
    {{ "from": "<argument_id>", "to": "<citation_id>", "structural": true | false }},
    ...
  ]
}}"#,
        msj = msj_text,
        unreliable = unreliable_count,
        total = validation_results.len(),
        citations = citation_reliability.join(",\n")
    );

    let raw = llm.call_json(MODEL_OPUS, SYSTEM, &user, 2500).await?;
    let output: GraphOutput = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("Failed to parse graph JSON: {}\nRaw: {}", e, raw))?;

    let nodes = output
        .nodes
        .into_iter()
        .map(|n| {
            let node_type = if n.node_type == "argument" {
                NodeType::Argument
            } else {
                NodeType::Citation
            };

            // For citation nodes: attach verdict from validation results
            let verdict = if matches!(node_type, NodeType::Citation) {
                validation_results
                    .iter()
                    .find(|v| {
                        // Match by the first party name or a distinctive substring
                        let citation_key = v.citation_string.split(',').next().unwrap_or("");
                        n.label.contains(citation_key)
                            || v.citation_string.contains(&n.label)
                            || citation_key.contains(&n.label)
                    })
                    .map(|v| v.verdict.clone())
            } else {
                None
            };

            // For argument nodes: encode survival status in the verdict field
            // survives=false → treat as Fabricated (red) to signal broken argument
            // survives=true  → treat as Verified (green) to signal intact argument
            let argument_status = if matches!(node_type, NodeType::Argument) {
                match n.survives_without_unreliable {
                    Some(false) => Some(crate::types::Verdict::Fabricated), // red — broken
                    Some(true)  => Some(crate::types::Verdict::Verified),   // green — intact
                    None        => Some(crate::types::Verdict::Unverifiable), // grey
                }
            } else {
                None
            };

            ArgumentNode {
                id: n.id,
                label: n.label,
                node_type,
                verdict: verdict.or(argument_status),
            }
        })
        .collect();

    let edges = output
        .edges
        .into_iter()
        .map(|e| ArgumentEdge {
            from: e.from,
            to: e.to,
            structural: e.structural,
        })
        .collect();

    Ok(ArgumentGraph { nodes, edges })
}
