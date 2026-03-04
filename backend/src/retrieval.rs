/// Case retrieval from CourtListener.
///
/// Strategy:
/// 1. Case name search → gets citeCount (key fabrication signal) + metadata
/// 2. If found: fetch PDF from CourtListener S3 storage → extract full text
/// 3. Quoted citation text search as fallback when no case name
///
/// The citeCount field is critical: a fabricated case will have 0 citations
/// in CourtListener's citation graph. A real but obscure case may have 1-5.
/// A well-known case like Privette has 261. This distinguishes "fabricated"
/// from "unpublished/obscure" when a case cannot be retrieved.
use std::time::Duration;

use anyhow::Result;
use serde::Deserialize;

use crate::types::{ExtractedCitation, RetrievalStatus, RetrievedCase};

const USER_AGENT: &str =
    "JudicialReview/0.1 (citation verification tool; contact: legalquant@protonmail.me)";
const COURTLISTENER_SEARCH: &str = "https://www.courtlistener.com/api/rest/v4/search/";
const COURTLISTENER_OPINIONS: &str = "https://www.courtlistener.com/api/rest/v4/opinions/";
const CL_STORAGE_BASE: &str = "https://storage.courtlistener.com/";

/// Read optional CourtListener API token from environment.
/// Free registration at https://www.courtlistener.com/sign-in/
/// Token from https://www.courtlistener.com/api/rest/v4/api-token-auth/
fn cl_api_token() -> Option<String> {
    std::env::var("COURTLISTENER_API_TOKEN").ok()
        .filter(|t| !t.is_empty() && t != "your_courtlistener_token_here")
}

fn build_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()?)
}

async fn rate_pause() {
    tokio::time::sleep(Duration::from_millis(400)).await;
}

// ── CourtListener response types ──────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClSearchResponse {
    count: u32,
    results: Vec<ClResult>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClResult {
    #[serde(rename = "caseName")]
    case_name: Option<String>,
    #[serde(rename = "caseNameFull")]
    case_name_full: Option<String>,
    #[serde(rename = "dateFiled")]
    date_filed: Option<String>,
    #[serde(rename = "court_citation_string")]
    court_citation_string: Option<String>,
    absolute_url: Option<String>,
    cluster_id: Option<u64>,
    citation: Option<Vec<String>>,
    #[serde(rename = "citeCount")]
    cite_count: Option<u32>,
    opinions: Option<Vec<ClOpinion>>,
    syllabus: Option<String>,
    #[serde(rename = "procedural_history")]
    procedural_history: Option<String>,
    posture: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClOpinion {
    id: Option<u64>,
    snippet: Option<String>,
    download_url: Option<String>,
    local_path: Option<String>,
    #[serde(rename = "type")]
    opinion_type: Option<String>,
}

// ── PDF text extraction ───────────────────────────────────────────────────────

/// Fetch full opinion text using the most reliable method available:
/// 1. Authenticated opinions/ endpoint → plain_text (requires free CL account)
/// 2. S3 PDF download → pdf-extract
/// 3. Returns None if neither is available (snippet will be used separately)
async fn fetch_full_text(
    client: &reqwest::Client,
    opinion_id: Option<u64>,
    local_path: Option<&str>,
) -> Option<String> {
    // Strategy 1: Authenticated opinions endpoint for plain_text
    if let (Some(id), Some(token)) = (opinion_id, cl_api_token()) {
        let url = format!("{}{}/?format=json", COURTLISTENER_OPINIONS, id);
        let resp = client
            .get(&url)
            .header("Authorization", format!("Token {}", token))
            .send()
            .await
            .ok()?;

        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // Try plain_text first, then html_with_citations (most reliable), then xml_harvard
                let text = json["plain_text"].as_str().filter(|s| s.trim().len() > 200)
                    .map(|s| s.trim()[..s.trim().len().min(12000)].to_string())
                    .or_else(|| {
                        // html_with_citations is typically the largest and most complete field
                        json["html_with_citations"].as_str()
                            .filter(|s| s.trim().len() > 200)
                            .and_then(|h| html2text::from_read(h.as_bytes(), 100).ok())
                            .filter(|s| s.trim().len() > 200)
                            .map(|s| {
                                let t = s.trim();
                                t[..t.len().min(12000)].to_string()
                            })
                    })
                    .or_else(|| {
                        // xml_harvard as final fallback
                        json["xml_harvard"].as_str()
                            .filter(|s| s.trim().len() > 200)
                            .and_then(|h| html2text::from_read(h.as_bytes(), 100).ok())
                            .filter(|s| s.trim().len() > 200)
                            .map(|s| {
                                let t = s.trim();
                                t[..t.len().min(12000)].to_string()
                            })
                    });

                if text.is_some() {
                    return text;
                }
            }
        }
    }

    // Strategy 2: S3 PDF
    if let Some(path) = local_path {
        if !path.is_empty() {
            let url = format!("{}{}", CL_STORAGE_BASE, path);
            if let Ok(resp) = client.get(&url).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if let Ok(text) = pdf_extract::extract_text_from_mem(&bytes) {
                            let trimmed = text.trim();
                            if trimmed.len() > 200 {
                                return Some(trimmed[..trimmed.len().min(12000)].to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Collect all available text from the search result: snippet + syllabus + posture.
fn assemble_text_from_result(result: &ClResult) -> String {
    let mut parts: Vec<&str> = Vec::new();

    if let Some(Some(snippet)) = result.opinions.as_ref().map(|ops| {
        ops.iter().filter_map(|o| o.snippet.as_deref()).find(|s| !s.is_empty())
    }) {
        parts.push(snippet);
    }

    if let Some(ref s) = result.syllabus {
        if !s.is_empty() { parts.push(s.as_str()); }
    }
    if let Some(ref p) = result.posture {
        if !p.is_empty() { parts.push(p.as_str()); }
    }
    if let Some(ref h) = result.procedural_history {
        if !h.is_empty() { parts.push(h.as_str()); }
    }

    parts.join("\n\n")
}

// ── Confidence scoring ────────────────────────────────────────────────────────

/// Compute a confidence score based on multiple signals:
/// - Year match between citation and retrieved case
/// - Citation count (citeCount): key fabrication signal
/// - Whether full text was retrieved
fn compute_confidence(
    citation: &ExtractedCitation,
    result: &ClResult,
    has_full_text: bool,
) -> f64 {
    let mut score = 0.60_f64; // base

    // Year match
    if let (Some(year), Some(date)) = (&citation.year, &result.date_filed) {
        if date.contains(year.as_str()) {
            score += 0.20;
        }
    }

    // Citation count — fabricated cases score 0 here
    // Scale: 0 cites → penalty, 1-10 → small boost, 11+ → full boost
    match result.cite_count.unwrap_or(0) {
        0 => score -= 0.30,      // strong fabrication signal
        1..=5 => score += 0.05,  // obscure but plausible
        6..=50 => score += 0.12,
        _ => score += 0.18,      // well-cited case — very likely real
    }

    // Full text retrieved
    if has_full_text {
        score += 0.05;
    }

    score.clamp(0.0, 0.97)
}

// ── Strategy 1: case name search ─────────────────────────────────────────────

async fn search_by_case_name(
    client: &reqwest::Client,
    citation: &ExtractedCitation,
) -> Option<RetrievedCase> {
    let name = citation.case_name.as_deref()?;
    let query = build_name_query(name);
    if query.is_empty() { return None; }

    let url = format!(
        "{}?type=o&case_name={}&format=json&page_size=3",
        COURTLISTENER_SEARCH,
        urlencoding::encode(&query)
    );

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() { return None; }

    let search: ClSearchResponse = resp.json().await.ok()?;

    if search.count == 0 || search.results.is_empty() {
        // Case name searched but not found in CourtListener.
        // Return a stub with cite_count=0 — potential fabrication signal.
        // (Note: if the reporter is not indexed, unresolvable() handles this instead)
        return Some(RetrievedCase {
            citation_id: citation.id.clone(),
            url: String::new(),
            source: "courtlistener".to_string(),
            confidence: 0.05,
            title: None,
            court_name: None,
            decision_date: None,
            full_text: None,
            cite_count: Some(0),
            resolution_method: "courtlistener_case_name_not_found".to_string(),
            status: RetrievalStatus::NotFound,
        });
    }

    let result = &search.results[0];

    // Try to get full text: authenticated opinions endpoint first, then S3 PDF
    let full_text = {
        let opinion = result.opinions.as_ref().and_then(|ops| ops.first());
        let opinion_id = opinion.and_then(|o| o.id);
        let local_path = opinion.and_then(|o| o.local_path.as_deref());
        fetch_full_text(client, opinion_id, local_path).await
            .or_else(|| {
                // Last resort: assembled snippet/syllabus if substantial
                let assembled = assemble_text_from_result(result);
                if assembled.len() > 500 { Some(assembled) } else { None }
            })
    };

    let has_full_text = full_text.as_ref().map(|t| t.len() > 200).unwrap_or(false);
    let confidence = compute_confidence(citation, result, has_full_text);

    let case_url = result.absolute_url.as_ref().map(|p| {
        if p.starts_with("http") { p.clone() }
        else { format!("https://www.courtlistener.com{}", p) }
    }).unwrap_or_default();

    Some(RetrievedCase {
        citation_id: citation.id.clone(),
        url: case_url,
        source: "courtlistener".to_string(),
        confidence,
        title: result.case_name.clone().or_else(|| result.case_name_full.clone()),
        court_name: result.court_citation_string.clone(),
        decision_date: result.date_filed.clone(),
        full_text,
        cite_count: result.cite_count,
        resolution_method: "courtlistener_case_name".to_string(),
        status: RetrievalStatus::Resolved,
    })
}

// ── Strategy 2: quoted citation string search ─────────────────────────────────

async fn search_by_citation_text(
    client: &reqwest::Client,
    citation: &ExtractedCitation,
) -> Option<RetrievedCase> {
    let cite_query = match (&citation.volume, &citation.page) {
        (Some(v), Some(p)) => format!("\"{}  {} {}\"", v, citation.reporter, p),
        _ => return None,
    };

    let url = format!(
        "{}?type=o&q={}&format=json&page_size=5",
        COURTLISTENER_SEARCH,
        urlencoding::encode(&cite_query)
    );

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() { return None; }

    let search: ClSearchResponse = resp.json().await.ok()?;
    if search.count == 0 || search.results.is_empty() { return None; }

    let best = if let Some(year) = &citation.year {
        search.results.iter()
            .find(|r| r.date_filed.as_deref().unwrap_or("").contains(year.as_str()))
            .or_else(|| search.results.first())
    } else {
        search.results.first()
    }?;

        // Try full text: opinions endpoint first, then S3 PDF
        let full_text = {
            let opinion = best.opinions.as_ref().and_then(|ops| ops.first());
            let opinion_id = opinion.and_then(|o| o.id);
            let local_path = opinion.and_then(|o| o.local_path.as_deref());
            fetch_full_text(client, opinion_id, local_path).await
                .or_else(|| {
                    let assembled = assemble_text_from_result(best);
                    if assembled.len() > 500 { Some(assembled) } else { None }
                })
        };

    let has_full_text = full_text.as_ref().map(|t| t.len() > 200).unwrap_or(false);
    let confidence = compute_confidence(citation, best, has_full_text);

    let case_url = best.absolute_url.as_ref().map(|p| {
        if p.starts_with("http") { p.clone() }
        else { format!("https://www.courtlistener.com{}", p) }
    }).unwrap_or_default();

    Some(RetrievedCase {
        citation_id: citation.id.clone(),
        url: case_url,
        source: "courtlistener".to_string(),
        confidence,
        title: best.case_name.clone(),
        court_name: best.court_citation_string.clone(),
        decision_date: best.date_filed.clone(),
        full_text,
        cite_count: best.cite_count,
        resolution_method: "courtlistener_quoted_citation".to_string(),
        status: RetrievalStatus::Resolved,
    })
}

// ── Name query builder ────────────────────────────────────────────────────────

fn build_name_query(name: &str) -> String {
    let stop_words = ["the", "of", "and", "a", "an", "inc", "llc", "llp", "ltd", "co", "corp"];

    let (pre, post) = if let Some(pos) = name.to_lowercase().find(" v.") {
        (&name[..pos], &name[pos + 3..])
    } else {
        (name, "")
    };

    let clean = |s: &str| -> String {
        s.split(|c: char| !c.is_alphanumeric())
            .map(|w| w.trim())
            .filter(|w| w.len() >= 2)
            .filter(|w| !stop_words.contains(&w.to_lowercase().as_str()))
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
    };

    format!("{} {}", clean(pre), clean(post)).trim().to_string()
}

// ── Main resolution function ──────────────────────────────────────────────────

pub async fn resolve_citation(citation: &ExtractedCitation) -> RetrievedCase {
    let client = match build_client() {
        Ok(c) => c,
        Err(e) => return unresolvable(citation, &format!("client error: {}", e)),
    };

    if citation.case_name.is_some() {
        let result = search_by_case_name(&client, citation).await;
        if let Some(r) = result {
            return r;
        }
    }

    rate_pause().await;

    if let Some(found) = search_by_citation_text(&client, citation).await {
        return found;
    }

    unresolvable(citation, "not found in CourtListener by name or quoted citation")
}

fn unresolvable(citation: &ExtractedCitation, reason: &str) -> RetrievedCase {
    // Distinguish between "not found" (possible fabrication) and "not indexed"
    // (real court whose decisions aren't in CourtListener's free index)
    let not_indexed_reporters = [
        "Cal.App.4th", "Cal.App.5th", "Cal.App.3d",  // Cal. Court of Appeal
        "Cal.Rptr.3d", "Cal.Rptr.2d",                 // Cal. unofficial reporters
        "N.Y.S.3d", "N.Y.S.2d",                        // NY Sup/App Div
        "A.3d", "A.2d",                                 // Atlantic Reporter (state courts)
        "So.2d",                                        // Southern Reporter older
        "S.E.2d", "S.E.3d",                            // South-Eastern Reporter
        "N.W.2d", "N.W.3d",                            // North-Western Reporter
        "P.3d", "P.2d",                                 // Pacific Reporter (state)
        "S.W.2d",                                       // South-Western Reporter older
    ];

    let is_not_indexed = not_indexed_reporters.contains(&citation.reporter.as_str());

    let status = if is_not_indexed {
        RetrievalStatus::NotIndexed
    } else {
        RetrievalStatus::NotFound
    };

    let resolution_method = if is_not_indexed {
        format!("not_indexed: {} decisions are not in CourtListener's free index ({})", citation.reporter, reason)
    } else {
        format!("not_found: {}", reason)
    };

    RetrievedCase {
        citation_id: citation.id.clone(),
        url: String::new(),
        source: String::new(),
        confidence: 0.0,
        title: None,
        court_name: None,
        decision_date: None,
        full_text: None,
        cite_count: None,
        resolution_method,
        status,
    }
}

pub async fn resolve_all(citations: &[ExtractedCitation]) -> Vec<RetrievedCase> {
    let mut results = Vec::new();
    for citation in citations {
        let resolved = resolve_citation(citation).await;
        results.push(resolved);
        rate_pause().await;
    }
    results
}
