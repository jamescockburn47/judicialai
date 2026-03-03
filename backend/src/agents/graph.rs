/// Graph Mapper Agent — Opus
/// Maps argument dependency: which citations are structural vs decorative.
/// Returns an ArgumentGraph (nodes + edges) for React Flow rendering.
use anyhow::Result;
use serde::Deserialize;

use crate::llm::{LlmClient, MODEL_OPUS};
use crate::types::{ArgumentEdge, ArgumentGraph, ArgumentNode, NodeType, ValidationResult};

const SYSTEM: &str = r#"You are a legal analyst mapping the argument structure of a motion. Your task is to produce a directed acyclic graph (DAG) of the motion's arguments and their citation dependencies.

A citation is STRUCTURAL if removing it would cause the argument to fail or be substantially weakened. It is DECORATIVE if it provides additional support but the argument stands without it.

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
    let verdicts_summary: Vec<String> = validation_results
        .iter()
        .map(|v| {
            format!(
                r#"{{ "citation": "{}", "verdict": "{:?}", "is_structural": {} }}"#,
                v.citation_string, v.verdict, v.is_structural
            )
        })
        .collect();

    let user = format!(
        r#"Here is the Motion for Summary Judgment:

<MSJ>
{}
</MSJ>

Citation verdicts from prior validation:
{}

Build a DAG of the motion's argument structure. Each main argument is a node. Each citation dependency is an edge from argument to citation.

Return JSON:
{{
  "nodes": [
    {{ "id": "<unique_id>", "label": "<short label>", "node_type": "argument" | "citation" }},
    ...
  ],
  "edges": [
    {{ "from": "<argument_id>", "to": "<citation_id>", "structural": true | false }},
    ...
  ]
}}"#,
        msj_text,
        verdicts_summary.join(",\n")
    );

    let raw = llm.call_json(MODEL_OPUS, SYSTEM, &user, 2000).await?;
    let output: GraphOutput = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("Failed to parse graph JSON: {}\nRaw: {}", e, raw))?;

    // Merge verdict info onto citation nodes
    let nodes = output
        .nodes
        .into_iter()
        .map(|n| {
            let node_type = if n.node_type == "argument" {
                NodeType::Argument
            } else {
                NodeType::Citation
            };

            // Match verdict from validation results by label substring
            let verdict = if matches!(node_type, NodeType::Citation) {
                validation_results
                    .iter()
                    .find(|v| {
                        n.label.contains(v.citation_string.split(',').next().unwrap_or(""))
                            || v.citation_string.contains(&n.label)
                    })
                    .map(|v| v.verdict.clone())
            } else {
                None
            };

            ArgumentNode {
                id: n.id,
                label: n.label,
                node_type,
                verdict,
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
