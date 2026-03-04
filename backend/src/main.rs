use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tracing::info;
use uuid::Uuid;

use bs_detector::agents::{consistency, graph, memo, propositions, validator};
use bs_detector::extractor;
use bs_detector::llm::LlmClient;
use bs_detector::retrieval;
use bs_detector::types::{
    AnalysisReport, AnalyzeRequest, ApprovedCitation, ChecklistItem, ChecklistItemType,
    CitationProposition, ExtractedCitation, ExtractRequest, ExtractResponse, RerunRequest,
    RerunResponse, ReviewStatus,
};

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    llm: Arc<LlmClient>,
    documents: Arc<HashMap<String, String>>,
    // Cache of last analysis report keyed by session (simplified: just one)
    report_cache: Arc<RwLock<Option<AnalysisReport>>>,
}

// ── LLM client resolution ─────────────────────────────────────────────────────
// Per-request: prefer X-Anthropic-Key header (from Tauri app's stored key),
// fall back to env var set at startup.

fn llm_from_headers(headers: &HeaderMap, state: &AppState) -> Result<LlmClient, (StatusCode, String)> {
    if let Some(key_header) = headers.get("x-anthropic-key") {
        if let Ok(key_str) = key_header.to_str() {
            if !key_str.is_empty() {
                return LlmClient::with_key(key_str.to_string())
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
        }
    }
    // Fall back to the startup client (env var)
    if state.llm.has_key() {
        return Ok((*state.llm).clone());
    }
    Err((
        StatusCode::UNAUTHORIZED,
        "No API key provided. Set ANTHROPIC_API_KEY in .env or add your key in the app settings.".to_string(),
    ))
}

// ── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "bs_detector=info,tower_http=info".into()),
        )
        .init();

    // Load .env
    let _ = dotenvy::dotenv();

    let llm = LlmClient::new()?;

    // Load documents — path configurable via DOCUMENTS_PATH env var
    let doc_path_str = std::env::var("DOCUMENTS_PATH")
        .unwrap_or_else(|_| "../documents".to_string());
    let documents = load_documents(Path::new(&doc_path_str))?;
    info!("Loaded {} documents from {}", documents.len(), doc_path_str);
    for name in documents.keys() {
        info!("  - {}", name);
    }

    let state = AppState {
        llm: Arc::new(llm),
        documents: Arc::new(documents),
        report_cache: Arc::new(RwLock::new(None)),
    };

    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:5175".parse::<axum::http::HeaderValue>().unwrap(),
            "http://localhost:1420".parse::<axum::http::HeaderValue>().unwrap(),
            "tauri://localhost".parse::<axum::http::HeaderValue>().unwrap(),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/test-key", post(test_key_handler))
        .route("/extract", post(extract_handler))
        .route("/analyze", post(analyze_handler))
        .route("/rerun", post(rerun_handler))
        .route("/report", get(get_report))
        .layer(cors)
        .with_state(state);

    let addr = "0.0.0.0:8002";
    info!("BS Detector API listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "service": "bs-detector" }))
}

/// POST /test-key
/// Validates the API key by making a minimal Haiku call from the backend.
/// Routes through here because WebView2 blocks direct fetch() to external origins.
async fn test_key_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let llm = match llm_from_headers(&headers, &state) {
        Ok(l) => l,
        Err((status, msg)) => {
            return (status, Json(json!({ "ok": false, "message": msg }))).into_response();
        }
    };

    match llm.call(
        "claude-haiku-4-5-20251001",
        "You are a test.",
        "Reply with exactly one word: OK",
        10,
    ).await {
        Ok(_) => Json(json!({ "ok": true, "message": "Connection verified — API key is working." })).into_response(),
        Err(e) => {
            let msg = e.to_string();
            let status = if msg.contains("401") {
                StatusCode::UNAUTHORIZED
            } else if msg.contains("429") {
                StatusCode::TOO_MANY_REQUESTS
            } else {
                StatusCode::BAD_GATEWAY
            };
            (status, Json(json!({ "ok": false, "message": msg }))).into_response()
        }
    }
}

/// POST /extract
/// 1. Run deterministic citation extractor on MSJ
/// 2. Retrieve cases from CourtListener / CAP
/// Returns citations + retrieved cases for user approval in the UI
async fn extract_handler(
    State(state): State<AppState>,
    _headers: HeaderMap,
    Json(req): Json<ExtractRequest>,
) -> Result<Json<ExtractResponse>, (StatusCode, String)> {
    // Extraction is deterministic (no LLM) — API key not required at this stage
    let doc_name = req
        .document_name
        .unwrap_or_else(|| "motion_for_summary_judgment.txt".to_string());

    // If a documents_path was provided by the client, read from disk.
    // Otherwise fall back to documents loaded at startup.
    let msj_text = if let Some(ref docs_path) = req.documents_path {
        let file_path = std::path::Path::new(docs_path).join(&doc_name);
        std::fs::read_to_string(&file_path)
            .map_err(|e| (StatusCode::NOT_FOUND, format!("Cannot read {}: {}", file_path.display(), e)))?
    } else {
        state
            .documents
            .get(&doc_name)
            .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Document '{}' not found", doc_name)))?
            .clone()
    };

    info!("Extracting citations from {}", doc_name);
    let citations = extractor::extract_citations(&msj_text, &doc_name);
    info!("Extracted {} citations", citations.len());

    info!("Retrieving cases from public databases...");
    let retrieved_cases = retrieval::resolve_all(&citations).await;
    info!("Retrieved {} case records", retrieved_cases.len());

    Ok(Json(ExtractResponse {
        citations,
        retrieved_cases,
    }))
}

/// POST /analyze
/// Runs the full sequential agent pipeline on user-approved citations.
async fn analyze_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AnalyzeRequest>,
) -> Result<Json<AnalysisReport>, (StatusCode, String)> {
    let llm = llm_from_headers(&headers, &state)?;
    let doc_name = req
        .document_name
        .unwrap_or_else(|| "motion_for_summary_judgment.txt".to_string());

    // Helper: read a document either from the provided path or from the startup cache
    let read_doc = |name: &str| -> String {
        if let Some(ref docs_path) = req.documents_path {
            let p = std::path::Path::new(docs_path).join(name);
            std::fs::read_to_string(&p).unwrap_or_default()
        } else {
            state.documents.get(name).cloned().unwrap_or_default()
        }
    };

    let msj_text = {
        let t = read_doc(&doc_name);
        if t.is_empty() {
            return Err((StatusCode::NOT_FOUND, format!("Document '{}' not found", doc_name)));
        }
        t
    };
    let police_report = read_doc("police_report.txt");
    let medical_records = read_doc("medical_records_excerpt.txt");
    let witness_statement = read_doc("witness_statement.txt");

    let approved = req.approved_citations;

    // Stage 3: Extract propositions (Sonnet)
    info!("Stage 3: Extracting propositions...");
    let propositions = propositions::extract_propositions(&llm, &msj_text, &approved)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Stage 4: Validate each citation (Opus)
    info!("Stage 4: Validating {} citations...", approved.len());
    let mut validation_results = Vec::new();
    for approved_citation in &approved {
        let prop = propositions
            .iter()
            .find(|p| p.citation_id == approved_citation.citation.id)
            .cloned()
            .unwrap_or_else(|| CitationProposition {
                citation_id: approved_citation.citation.id.clone(),
                proposition: "Unknown — proposition not extracted".to_string(),
                has_direct_quote: false,
                quoted_text: None,
                argument_section: "Unknown".to_string(),
            });

        let result =
            validator::validate_citation(&llm, approved_citation, &prop, None)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        validation_results.push(result);
    }

    // Stage 5: Consistency check (Opus)
    info!("Stage 5: Checking SUMF consistency...");
    let consistency_flags = consistency::check_consistency(
        &llm,
        &msj_text,
        &police_report,
        &medical_records,
        &witness_statement,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Stage 6: Graph mapping (Opus)
    info!("Stage 6: Building argument graph...");
    let argument_graph = graph::build_graph(&llm, &msj_text, &validation_results)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Stage 7: Judicial memo (Opus)
    info!("Stage 7: Writing judicial memo...");
    let judicial_memo = memo::write_memo(
        &llm,
        &msj_text,
        &validation_results,
        &consistency_flags,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Build Collate-style checklist
    let checklist = build_checklist(&validation_results, &consistency_flags);

    let report = AnalysisReport {
        case_name: "Rivera v. Harmon Construction Group, Inc.".to_string(),
        document: doc_name,
        validation_results,
        consistency_flags,
        argument_graph,
        judicial_memo,
        checklist,
        created_at: chrono_now(),
    };

    // Cache report
    *state.report_cache.write().await = Some(report.clone());

    Ok(Json(report))
}

/// POST /rerun
/// Reruns validation for a single citation with a judge's note prepended.
async fn rerun_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RerunRequest>,
) -> Result<Json<RerunResponse>, (StatusCode, String)> {
    let llm = llm_from_headers(&headers, &state)?;
    let cached = state.report_cache.read().await.clone().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "No analysis has been run yet — call /analyze first".to_string(),
        )
    })?;

    // Find the citation in the previous validation results
    let prev_result = cached
        .validation_results
        .iter()
        .find(|v| v.citation_id == req.citation_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                format!("Citation ID {} not found in cached report", req.citation_id),
            )
        })?;

    // Reconstruct a minimal ApprovedCitation + CitationProposition for rerun
        let approved = ApprovedCitation {
        citation: ExtractedCitation {
            id: prev_result.citation_id.clone(),
            citation_string: prev_result.citation_string.clone(),
            case_name: None,
            reporter: String::new(),
            volume: None,
            page: None,
            pinpoint: None,
            year: None,
            court: None,
            location_in_doc: String::new(),
        },
            retrieved_case: None,        user_approved: true,
        user_note: Some(req.judge_note.clone()),
    };

        let prop = CitationProposition {
                citation_id: prev_result.citation_id.clone(),
        proposition: prev_result.proposition.clone(),
        has_direct_quote: prev_result.quote_accurate.is_some(),
        quoted_text: None,
        argument_section: String::new(),
    };

    info!(
        "Rerunning validation for {} with judge note: {}",
        req.citation_id, req.judge_note
    );

    let updated_result =
        validator::validate_citation(&llm, &approved, &prop, Some(&req.judge_note))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update cache
    let mut cache = state.report_cache.write().await;
    if let Some(ref mut report) = *cache {
        if let Some(pos) = report
            .validation_results
            .iter()
            .position(|v| v.citation_id == req.citation_id)
        {
            report.validation_results[pos] = updated_result.clone();
        }
    }

    Ok(Json(RerunResponse { updated_result }))
}

/// GET /report — returns cached report if available
async fn get_report(
    State(state): State<AppState>,
) -> Result<Json<AnalysisReport>, (StatusCode, String)> {
    state
        .report_cache
        .read()
        .await
        .clone()
        .map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "No report available".to_string()))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn load_documents(dir: &Path) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    if !dir.exists() {
        return Ok(map);
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("txt") {
            let name = path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let content = std::fs::read_to_string(&path)?;
            map.insert(name, content);
        }
    }
    Ok(map)
}

fn build_checklist(
    validation_results: &[bs_detector::types::ValidationResult],
    consistency_flags: &[bs_detector::types::ConsistencyFlag],
) -> Vec<ChecklistItem> {
    let mut items = Vec::new();

    for v in validation_results {
        items.push(ChecklistItem {
            id: v.citation_id.clone(),  // use citation_id so frontend can match retrievedCases
            item_type: ChecklistItemType::Citation,
            label: v.citation_string.clone(),
            verdict: Some(v.verdict.clone()),
            confidence: Some(v.confidence.clone()),
            status: ReviewStatus::Pending,
            judge_note: None,
            rerun_count: 0,
        });
    }

    for f in consistency_flags {
        items.push(ChecklistItem {
            id: Uuid::new_v4().to_string(),
            item_type: ChecklistItemType::ConsistencyFlag,
            label: f.sumf_assertion.clone(),
            verdict: None,
            confidence: None,
            status: ReviewStatus::Pending,
            judge_note: None,
            rerun_count: 0,
        });
    }

    items
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono dependency
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("Unix timestamp: {}", secs)
}
