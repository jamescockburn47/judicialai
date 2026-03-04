use serde::{Deserialize, Serialize};

// ── Citation extracted from document ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedCitation {
    pub id: String,
    pub citation_string: String,
    pub case_name: Option<String>,
    pub reporter: String,
    pub volume: Option<String>,
    pub page: Option<String>,
    pub pinpoint: Option<String>,
    pub year: Option<String>,
    pub court: Option<String>,
    pub location_in_doc: String,
}

// ── Retrieved case from public database ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievedCase {
    pub citation_id: String,
    pub url: String,
    pub source: String,
    pub confidence: f64,
    pub title: Option<String>,
    pub court_name: Option<String>,
    pub decision_date: Option<String>,
    pub full_text: Option<String>,
    /// Number of times this case appears in CourtListener's citation graph.
    /// 0 is a strong fabrication signal. None means the count was not retrieved.
    pub cite_count: Option<u32>,
    pub resolution_method: String,
    pub status: RetrievalStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalStatus {
    /// Case found and text retrieved
    Resolved,
    /// Searched but not found in any indexed database — potential fabrication signal
    NotFound,
    /// Case exists in a jurisdiction/database not indexed (e.g. Cal.App.4th in CourtListener)
    /// Not a fabrication signal — just outside current coverage
    NotIndexed,
    /// Technical retrieval error
    Error(String),
}

// ── Approved citation (user confirmed after retrieval) ────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovedCitation {
    pub citation: ExtractedCitation,
    pub retrieved_case: Option<RetrievedCase>,
    pub user_approved: bool,
    pub user_note: Option<String>,
}

// ── Proposition extracted from MSJ for a single citation ─────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CitationProposition {
    pub citation_id: String,
    pub proposition: String,
    pub has_direct_quote: bool,
    pub quoted_text: Option<String>,
    pub argument_section: String,
}

// ── Validator verdict for a single citation ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub citation_id: String,
    pub citation_string: String,
    pub proposition: String,
    pub verdict: Verdict,
    pub confidence: ConfidenceLevel,
    pub reasoning: String,
    pub quote_accurate: Option<bool>,
    pub quote_analysis: Option<String>,
    pub is_structural: bool,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Verified,
    Suspect,
    Misused,
    Fabricated,
    Unverifiable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    High,
    Medium,
    Low,
}

// ── Cross-document consistency check ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsistencyFlag {
    pub id: String,
    pub sumf_assertion: String,
    pub supported_by: Vec<String>,
    pub contradicted_by: Vec<String>,
    pub status: ConsistencyStatus,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsistencyStatus {
    Supported,
    Contradicted,
    Unsupported,
    Partial,
}

// ── Argument graph node/edge ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentNode {
    pub id: String,
    pub label: String,
    pub node_type: NodeType,
    pub verdict: Option<Verdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Argument,
    Citation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentEdge {
    pub from: String,
    pub to: String,
    pub structural: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentGraph {
    pub nodes: Vec<ArgumentNode>,
    pub edges: Vec<ArgumentEdge>,
}

// ── Resolution checklist item (Collate-style) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub id: String,
    pub item_type: ChecklistItemType,
    pub label: String,
    pub verdict: Option<Verdict>,
    pub confidence: Option<ConfidenceLevel>,
    pub status: ReviewStatus,
    pub judge_note: Option<String>,
    pub rerun_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChecklistItemType {
    Citation,
    ConsistencyFlag,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    Pending,
    Accepted,
    Flagged,
    Rerunning,
}

// ── Full analysis report ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisReport {
    pub case_name: String,
    pub document: String,
    pub validation_results: Vec<ValidationResult>,
    pub consistency_flags: Vec<ConsistencyFlag>,
    pub argument_graph: ArgumentGraph,
    pub judicial_memo: String,
    pub checklist: Vec<ChecklistItem>,
    pub created_at: String,
}

// ── Request/response types for API endpoints ─────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ExtractRequest {
    pub document_name: Option<String>,
    /// Absolute path to the matter's documents folder. If provided, overrides
    /// the server's default DOCUMENTS_PATH env var.
    pub documents_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExtractResponse {
    pub citations: Vec<ExtractedCitation>,
    pub retrieved_cases: Vec<RetrievedCase>,
}

#[derive(Debug, Deserialize)]
pub struct AnalyzeRequest {
    pub approved_citations: Vec<ApprovedCitation>,
    pub document_name: Option<String>,
    pub documents_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RerunRequest {
    pub citation_id: String,
    pub judge_note: String,
}

#[derive(Debug, Serialize)]
pub struct RerunResponse {
    pub updated_result: ValidationResult,
}
