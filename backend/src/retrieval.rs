/// Case retrieval from US public legal databases.
/// Strategy:
///   1. CourtListener case_name search (no auth needed, exact name match)
///   2. CourtListener citation text search (fallback for less specific names)
/// Full text: uses opinion snippet from search results + download_url if available.
use std::time::Duration;

use anyhow::Result;
use serde::Deserialize;

use crate::types::{ExtractedCitation, RetrievalStatus, RetrievedCase};

const USER_AGENT: &str = "JudicialReview/0.1 (citation verification; contact: legalquant@protonmail.me)";
const COURTLISTENER_SEARCH: &str = "https://www.courtlistener.com/api/rest/v4/search/";

fn build_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
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
    opinions: Option<Vec<ClOpinion>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ClOpinion {
    snippet: Option<String>,
    download_url: Option<String>,
    #[serde(rename = "type")]
    opinion_type: Option<String>,
}

// ── Strategy 1: exact case name search ───────────────────────────────────────

async fn search_by_case_name(
    client: &reqwest::Client,
    citation: &ExtractedCitation,
) -> Option<RetrievedCase> {
    let name = citation.case_name.as_deref()?;

    // Build a clean query from the party names (drop stop words and Inc/LLC etc)
    let query = build_name_query(name);
    if query.is_empty() {
        return None;
    }

    let url = format!(
        "{}?type=o&case_name={}&format=json&page_size=3",
        COURTLISTENER_SEARCH,
        urlencoding::encode(&query)
    );

    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let search: ClSearchResponse = resp.json().await.ok()?;
    if search.count == 0 || search.results.is_empty() {
        return None;
    }

    let result = &search.results[0];

    // Year-match boost: if the result's date matches the citation year, it's a strong match
    let confidence = if let (Some(year), Some(date)) = (&citation.year, &result.date_filed) {
        if date.contains(year.as_str()) { 0.95 } else { 0.72 }
    } else {
        0.80
    };

    let snippet_text = extract_text_from_result(result);
    let case_url = result.absolute_url.as_ref().map(|p| {
        if p.starts_with("http") { p.clone() } else { format!("https://www.courtlistener.com{}", p) }
    }).unwrap_or_default();

    // Fetch full opinion text — much more useful for AI validation than a 277-char snippet
    let full_text = fetch_full_opinion_text(client, &case_url).await
        .filter(|t| t.len() > 200)
        .unwrap_or(snippet_text);

    Some(RetrievedCase {
        citation_id: citation.id.clone(),
        url: case_url,
        source: "courtlistener".to_string(),
        confidence,
        title: result.case_name.clone().or(result.case_name_full.clone()),
        court_name: result.court_citation_string.clone(),
        decision_date: result.date_filed.clone(),
        full_text: Some(full_text),
        resolution_method: "courtlistener_case_name".to_string(),
        status: RetrievalStatus::Resolved,
    })
}

// ── Strategy 2: citation string search (volume reporter page) ────────────────

async fn search_by_citation_text(
    client: &reqwest::Client,
    citation: &ExtractedCitation,
) -> Option<RetrievedCase> {
    // Build quoted cite string e.g. "52 Cal.4th 590"
    let cite_query = match (&citation.volume, &citation.page) {
        (Some(v), Some(p)) => format!("\"{}  {} {}\"", v, citation.reporter, p),
        _ => return None,
    };
    // Also try without the space variant
    let cite_query2 = match (&citation.volume, &citation.page) {
        (Some(v), Some(p)) => format!("\"{}. {} {}\"", v, citation.reporter, p),
        _ => cite_query.clone(),
    };

    for query in &[cite_query.clone(), cite_query2] {
        let url = format!(
            "{}?type=o&q={}&format=json&page_size=5",
            COURTLISTENER_SEARCH,
            urlencoding::encode(query)
        );

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => continue,
        };
        if !resp.status().is_success() { continue; }

        let search: ClSearchResponse = match resp.json().await {
            Ok(s) => s,
            Err(_) => continue,
        };
        if search.count == 0 || search.results.is_empty() { continue; }

        // Year-filter if available
        let best = if let Some(year) = &citation.year {
            search.results.iter()
                .find(|r| r.date_filed.as_deref().unwrap_or("").contains(year.as_str()))
                .or_else(|| search.results.first())
        } else {
            search.results.first()
        }?;

        let snippet_text = extract_text_from_result(best);
        let case_url = best.absolute_url.as_ref().map(|p| {
            if p.starts_with("http") { p.clone() }
            else { format!("https://www.courtlistener.com{}", p) }
        }).unwrap_or_default();

        let full_text = fetch_full_opinion_text(client, &case_url).await
            .filter(|t| t.len() > 200)
            .unwrap_or(snippet_text);

        let confidence = if citation.year.as_deref().unwrap_or("") ==
            best.date_filed.as_deref().unwrap_or("")[..4.min(best.date_filed.as_deref().unwrap_or("").len())].to_string() {
            0.88
        } else {
            0.70
        };

        return Some(RetrievedCase {
            citation_id: citation.id.clone(),
            url: case_url,
            source: "courtlistener".to_string(),
            confidence,
            title: best.case_name.clone(),
            court_name: best.court_citation_string.clone(),
            decision_date: best.date_filed.clone(),
            full_text: Some(full_text),
            resolution_method: "courtlistener_quoted_citation".to_string(),
            status: RetrievalStatus::Resolved,
        });
    }

    None
}

// ── Text extraction from search result ───────────────────────────────────────

fn extract_text_from_result(result: &ClResult) -> String {
    let opinions = match &result.opinions {
        Some(ops) if !ops.is_empty() => ops,
        _ => return String::new(),
    };

    // Concatenate all available snippets
    let snippets: String = opinions.iter()
        .filter_map(|o| o.snippet.as_deref())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    snippets
}

/// Fetch full opinion text from a CourtListener opinion HTML page.
/// CourtListener renders opinion text in <div id="opinion-content"> or similar.
/// Falls back to html2text on the full page body.
async fn fetch_full_opinion_text(client: &reqwest::Client, url: &str) -> Option<String> {
    if url.is_empty() { return None; }

    // Only attempt for courtlistener.com URLs
    if !url.contains("courtlistener.com") { return None; }

    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() { return None; }

    let html = resp.text().await.ok()?;
    if html.len() < 1000 { return None; }

    // Extract text from the opinion body — CourtListener wraps opinion text in
    // specific divs. Use html2text to strip markup and get readable plain text.
    let text = html2text::from_read(html.as_bytes(), 100).unwrap_or_default();

    // Trim boilerplate: CourtListener pages have a lot of nav/header above the opinion.
    // Find the first occurrence of the case name or a legal indicator.
    let legal_markers = ["Cal.", "F.2d", "F.3d", "F.4th", "U.S.", "HELD", "OPINION", "JUSTICE", "JUDGE", "Court of Appeal", "Supreme Court"];
    let start = legal_markers.iter()
        .filter_map(|m| text.find(m))
        .min()
        .unwrap_or(0);

    let extracted = text[start..].trim().to_string();
    if extracted.len() > 200 {
        Some(extracted[..extracted.len().min(8000)].to_string())
    } else {
        None
    }
}

// ── Name query builder ────────────────────────────────────────────────────────

fn build_name_query(name: &str) -> String {
    // Extract the pre-"v." party and post-"v." party, then take the most distinctive words
    let (pre, post) = if let Some(pos) = name.to_lowercase().find(" v.") {
        (&name[..pos], &name[pos + 3..])
    } else {
        (name, "")
    };

    // Generic stop words only — keep specific names like "Insurance", "Pacific"
    let stop_words = ["the", "of", "and", "a", "an", "inc", "llc", "llp", "ltd", "co", "corp"];

    let clean = |s: &str| -> String {
        s.split(|c: char| !c.is_alphanumeric())
            .map(|w| w.trim())
            .filter(|w| w.len() >= 2)
            .filter(|w| !stop_words.contains(&w.to_lowercase().as_str()))
            .take(2)
            .collect::<Vec<_>>()
            .join(" ")
    };

    let pre_words = clean(pre);
    let post_words = clean(post);

    format!("{} {}", pre_words, post_words).trim().to_string()
}

// ── Main resolution function ──────────────────────────────────────────────────

pub async fn resolve_citation(citation: &ExtractedCitation) -> RetrievedCase {
    let client = match build_client() {
        Ok(c) => c,
        Err(e) => return unresolvable(citation, &format!("client error: {}", e)),
    };

    // Strategy 1: case name search — if we have a name, trust the result or mark unresolvable
    if citation.case_name.is_some() {
        match search_by_case_name(&client, citation).await {
            Some(found) => return found,
            None => {
                // Case name searched but found nothing — likely fabricated or very obscure
                // Don't fall back to citation text search (which gives false positives)
                return unresolvable(citation, "not found in CourtListener by case name");
            }
        }
    }

    rate_pause().await;

    // Strategy 2: citation text search only when we have no case name at all
    if let Some(found) = search_by_citation_text(&client, citation).await {
        return found;
    }

    unresolvable(citation, "no case name and citation text search returned no match")
}

fn unresolvable(citation: &ExtractedCitation, reason: &str) -> RetrievedCase {
    RetrievedCase {
        citation_id: citation.id.clone(),
        url: String::new(),
        source: String::new(),
        confidence: 0.0,
        title: None,
        court_name: None,
        decision_date: None,
        full_text: None,
        resolution_method: format!("unresolvable: {}", reason),
        status: RetrievalStatus::Unresolvable,
    }
}

pub async fn resolve_all(citations: &[ExtractedCitation]) -> Vec<RetrievedCase> {
    let mut results = Vec::new();
    for citation in citations {
        let resolved = resolve_citation(citation).await;
        results.push(resolved);
        // Be a polite API citizen
        rate_pause().await;
    }
    results
}
