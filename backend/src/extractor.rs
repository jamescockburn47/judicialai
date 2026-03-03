/// Deterministic Rust citation parser adapted from CaseKit.
/// Targets US reporter citation formats — no LLM call.
use regex::Regex;
use uuid::Uuid;

use crate::types::ExtractedCitation;

struct CitationPattern {
    reporter_code: &'static str,
    court_hint: &'static str,
    regex: &'static str,
}

// US reporter patterns: volume Reporter page (pinpoint?) (court year)
// e.g.  887 F.2d 1204, 1209 (9th Cir. 1991)
//       52 Cal.4th 590, 598 (2011)
//       334 F. Supp. 2d 1189, 1195 (C.D. Cal. 2004)
const PATTERNS: &[CitationPattern] = &[
    CitationPattern {
        reporter_code: "U.S.",
        court_hint: "SCOTUS",
        regex: r"(\d+)\s+U\.S\.\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "S.Ct.",
        court_hint: "SCOTUS",
        regex: r"(\d+)\s+S\.\s*Ct\.\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "F.4th",
        court_hint: "Circuit",
        regex: r"(\d+)\s+F\.4th\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "F.3d",
        court_hint: "Circuit",
        regex: r"(\d+)\s+F\.3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "F.2d",
        court_hint: "Circuit",
        regex: r"(\d+)\s+F\.2d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "F.Supp.3d",
        court_hint: "District",
        regex: r"(\d+)\s+F\.\s*Supp\.\s*3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "F.Supp.2d",
        court_hint: "District",
        regex: r"(\d+)\s+F\.\s*Supp\.\s*2d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "F.Supp.",
        court_hint: "District",
        regex: r"(\d+)\s+F\.\s*Supp\.\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "Cal.5th",
        court_hint: "Cal. Supreme",
        regex: r"(\d+)\s+Cal\.5th\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "Cal.4th",
        court_hint: "Cal. Supreme",
        regex: r"(\d+)\s+Cal\.4th\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "Cal.3d",
        court_hint: "Cal. Supreme",
        regex: r"(\d+)\s+Cal\.3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "Cal.App.5th",
        court_hint: "Cal. App.",
        regex: r"(\d+)\s+Cal\.App\.5th\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "Cal.App.4th",
        court_hint: "Cal. App.",
        regex: r"(\d+)\s+Cal\.App\.4th\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
    CitationPattern {
        reporter_code: "S.W.3d",
        court_hint: "Texas/Missouri",
        regex: r"(\d+)\s+S\.W\.3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "So.3d",
        court_hint: "Florida/Louisiana",
        regex: r"(\d+)\s+So\.3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\([^)]*\d{4}\))?",
    },
    CitationPattern {
        reporter_code: "N.Y.3d",
        court_hint: "N.Y. Court of Appeals",
        regex: r"(\d+)\s+N\.Y\.3d\s+(\d+)(?:,\s+(\d+))?(?:\s+\((\d{4})\))?",
    },
];

// Regex to extract a case name from a lookback window.
// Requires both parties to be reasonable length (no sentence-spanning).
// Pre-v. party: starts capital, max ~50 chars, ends before "v."
// Post-v. party: starts capital, max ~50 chars, ends before volume digit
const CASE_NAME_RE: &str = r"([A-Z][A-Za-z0-9][A-Za-z0-9 ,\.&']{1,50}?(?:v\.|vs\.) [A-Za-z][A-Za-z0-9][A-Za-z0-9 ,\.&']{1,50}?),\s*\d";

pub fn extract_citations(text: &str, source_doc: &str) -> Vec<ExtractedCitation> {
    let mut citations: Vec<ExtractedCitation> = Vec::new();
    let case_name_re = Regex::new(CASE_NAME_RE).expect("case name regex");

    for pattern in PATTERNS {
        let re = match Regex::new(pattern.regex) {
            Ok(r) => r,
            Err(_) => continue,
        };

        for cap in re.captures_iter(text) {
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            let match_start = cap.get(0).map(|m| m.start()).unwrap_or(0);

            // Look back up to 200 chars, prefer trimming at newline to avoid cross-line capture.
            // If trimmed window has no "v.", fall back to full raw lookback (handles cases
            // where citation is at the end of a long sentence).
            let lookback_start = match_start.saturating_sub(200);
            let raw_lookback = &text[lookback_start..match_start];
            let trimmed_lookback = if let Some(nl) = raw_lookback.rfind('\n') {
                let after_nl = &raw_lookback[nl + 1..];
                if after_nl.contains("v.") || after_nl.contains("vs.") {
                    after_nl
                } else {
                    raw_lookback
                }
            } else {
                raw_lookback
            };
            // Strip leading "See also ", "See " etc
            let trimmed_lookback = {
                let s = trimmed_lookback.trim_start();
                if let Some(rest) = s.strip_prefix("See also ") { rest }
                else if let Some(rest) = s.strip_prefix("See ") { rest }
                else { s }
            };
            // Include a few chars of the match so the \d anchor can match the volume
            let search_window_end = (match_start + 5).min(text.len());
            let search_text = format!("{}{}", trimmed_lookback, &text[match_start..search_window_end]);
            let case_name = case_name_re
                .captures_iter(&search_text)
                .last()
                .and_then(|c| c.get(1))
                .map(|m| {
                    let s = m.as_str().trim();
                    // Strip leading "See also ", "See " etc
                    let s = if let Some(r) = s.strip_prefix("See also ") { r }
                        else if let Some(r) = s.strip_prefix("See ") { r }
                        else { s };
                    // Strip trailing ". See..." clauses
                    let s = if let Some(pos) = s.find(". See") { &s[..pos] } else { s };
                    s.trim().to_string()
                })
                .filter(|n| !n.is_empty() && n.contains("v."));

            let volume = cap.get(1).map(|m| m.as_str().to_string());
            let page = cap.get(2).map(|m| m.as_str().to_string());
            let pinpoint = cap.get(3).map(|m| m.as_str().to_string());

            // Year: try capture group 4, else scan parenthetical in full_match
            let year = cap.get(4).map(|m| m.as_str().to_string()).or_else(|| {
                let year_re = Regex::new(r"\(.*?(\d{4})\)").ok()?;
                year_re
                    .captures(full_match)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
            });

            // Court: extract from parenthetical
            let court = extract_court_from_parens(full_match, pattern.court_hint);

            // Build citation string
            let citation_string = if let Some(ref name) = case_name {
                format!("{}, {}", name, full_match)
            } else {
                full_match.to_string()
            };

            // Deduplicate: skip if citation string is already captured or is a substring of one
            if citations.iter().any(|c: &ExtractedCitation| {
                let a = c.citation_string.trim();
                let b = citation_string.trim();
                a == b || a.starts_with(b) || b.starts_with(a)
            }) {
                continue;
            }

            citations.push(ExtractedCitation {
                id: Uuid::new_v4().to_string(),
                citation_string,
                case_name,
                reporter: pattern.reporter_code.to_string(),
                volume,
                page,
                pinpoint,
                year,
                court,
                location_in_doc: source_doc.to_string(),
            });
        }
    }

    citations
}

fn extract_court_from_parens(text: &str, hint: &str) -> Option<String> {
    let re = Regex::new(r"\(([^)]+)\)").ok()?;
    for cap in re.captures_iter(text) {
        let inner = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        // Must contain a year and something that looks like a court
        if inner.contains(char::is_numeric) && inner.len() > 4 {
            return Some(inner.to_string());
        }
    }
    // Fall back to the hint from the pattern
    if !hint.is_empty() {
        Some(hint.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_f2d_citation() {
        let text = "Kellerman v. Pacific Coast Construction, Inc., 887 F.2d 1204, 1209 (9th Cir. 1991)";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty(), "should extract at least one citation");
        let c = &results[0];
        assert_eq!(c.reporter, "F.2d");
        assert_eq!(c.volume.as_deref(), Some("887"));
        assert_eq!(c.page.as_deref(), Some("1204"));
        assert_eq!(c.pinpoint.as_deref(), Some("1209"));
        assert_eq!(c.year.as_deref(), Some("1991"));
    }

    #[test]
    fn extracts_cal4th_citation() {
        // Test with preceding sentence — matches actual MSJ context for Seabright
        let text = "compliance with statutory safety requirements is highly probative of the exercise of due care. Seabright Insurance Co. v. US Airways, Inc., 52 Cal.4th 590, 598 (2011).";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty(), "should extract Seabright from mid-sentence context");
        let c = &results[0];
        assert_eq!(c.reporter, "Cal.4th");
        assert_eq!(c.year.as_deref(), Some("2011"));
        assert!(
            c.case_name.as_deref().unwrap_or("").contains("Seabright"),
            "case_name should contain Seabright, got: {:?}", c.case_name
        );
    }

    #[test]
    fn extracts_privette_citation() {
        let text = "Privette v. Superior Court, 5 Cal.4th 689, 702 (1993)";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty());
        assert_eq!(results[0].reporter, "Cal.4th");
    }

    #[test]
    fn extracts_multiple_citations() {
        let msj = std::fs::read_to_string("../documents/motion_for_summary_judgment.txt")
            .unwrap_or_default();
        if !msj.is_empty() {
            let results = extract_citations(&msj, "msj");
            // MSJ has at least 5 citations
            assert!(results.len() >= 5, "expected >= 5 citations, got {}", results.len());
        }
    }
}
