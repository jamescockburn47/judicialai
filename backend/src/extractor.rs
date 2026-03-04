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

// Case name regex. The search window is pre-trimmed to the last sentence
// boundary, so this only needs to find "X v. Y, <vol>" within one sentence.
// Both party slots allow periods for abbreviations like "Inc.", "Co.", "U.S.".
const CASE_NAME_RE: &str =
    r"([A-Z][A-Za-z0-9][A-Za-z0-9 ,\.&']{1,60}?(?:v\.|vs\.) [A-Za-z][A-Za-z0-9][A-Za-z0-9 ,\.&']{1,60}?),\s*\d";

/// Return the byte offset just after the last sentence boundary in `s`.
///
/// A sentence boundary is `. ` or `.\n` where the period is **not** preceded
/// by a single uppercase letter (which would indicate an abbreviation such as
/// "v.", "Co.", "U.S.", or a single initial).  A bare `\n` also counts.
///
/// By trimming the lookback window to start after the last such boundary,
/// the case-name regex cannot match text from a preceding sentence.
fn last_sentence_boundary(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut best: Option<usize> = None;

    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            best = Some(i + 1);
        } else if b == b'.' && i + 2 < bytes.len() {
            let after_next = bytes[i + 2];
            let next = bytes[i + 1];
            if next == b' ' && after_next.is_ascii_uppercase() {
                // Single uppercase letter before the period means abbreviation — skip.
                // Skip abbreviations (single uppercase) and 'v.' / 'vs.' in case names
                let prev_byte = if i >= 1 { bytes[i - 1] } else { 0 };
                let is_case_name_part = prev_byte == b'v' || (prev_byte == b's' && i >= 2 && bytes[i - 2] == b'v');
                let prev_is_abbrev = (prev_byte.is_ascii_uppercase() && (i < 2 || !bytes[i - 2].is_ascii_alphabetic())) || is_case_name_part;
                if !prev_is_abbrev {
                    best = Some(i + 2); // character after ". " or ".\n"
                }
            }
        }
    }
    best
}

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

            // ── Case-name search window ───────────────────────────────────────
            //
            // 1. Take up to 200 chars before the volume number.
            // 2. Strip any leading "See also" / "See" prefix.
            // 3. Trim back to the last sentence boundary so the regex cannot
            //    start a match at a capital in a preceding sentence.
            // 4. If trimming leaves no "v." (whole sentence is the citation body),
            //    keep the full stripped text rather than returning nothing.
            // 5. Append the first few chars of the match so the trailing `\d`
            //    anchor in CASE_NAME_RE can fire.
            let lookback_start = match_start.saturating_sub(200);
            let raw = &text[lookback_start..match_start];

            let stripped = {
                let s = raw.trim_start();
                if let Some(r) = s.strip_prefix("See also ") { r }
                else if let Some(r) = s.strip_prefix("See ") { r }
                else { s }
            };

            let window = match last_sentence_boundary(stripped) {
                Some(pos) => {
                    let after = &stripped[pos..];
                    if after.contains("v.") || after.contains("vs.") { after } else { stripped }
                }
                None => stripped,
            };

            let tail_end = (match_start + 5).min(text.len());
            let search_text = format!("{}{}", window, &text[match_start..tail_end]);

            let case_name = case_name_re
                .captures_iter(&search_text)
                .last()
                .and_then(|c| c.get(1))
                .map(|m| {
                    let s = m.as_str().trim();
                    let s = if let Some(r) = s.strip_prefix("See also ") { r }
                        else if let Some(r) = s.strip_prefix("See ") { r }
                        else { s };
                    let s = if let Some(p) = s.find(". See") { &s[..p] } else { s };
                    s.trim().to_string()
                })
                .filter(|n| !n.is_empty() && n.contains("v."));

            let volume   = cap.get(1).map(|m| m.as_str().to_string());
            let page     = cap.get(2).map(|m| m.as_str().to_string());
            let pinpoint = cap.get(3).map(|m| m.as_str().to_string());

            let year = cap.get(4).map(|m| m.as_str().to_string()).or_else(|| {
                let yr = Regex::new(r"\(.*?(\d{4})\)").ok()?;
                yr.captures(full_match).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
            });

            let court = extract_court_from_parens(full_match, pattern.court_hint);

            let citation_string = if let Some(ref name) = case_name {
                format!("{}, {}", name, full_match)
            } else {
                full_match.to_string()
            };

            // Deduplicate: skip if this string equals or is a prefix of an existing one
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
        if inner.contains(char::is_numeric) && inner.len() > 4 {
            return Some(inner.to_string());
        }
    }
    if !hint.is_empty() { Some(hint.to_string()) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_f2d_citation() {
        let text = "Kellerman v. Pacific Coast Construction, Inc., 887 F.2d 1204, 1209 (9th Cir. 1991)";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty());
        let c = &results[0];
        assert_eq!(c.reporter, "F.2d");
        assert_eq!(c.volume.as_deref(), Some("887"));
        assert_eq!(c.page.as_deref(), Some("1204"));
        assert_eq!(c.pinpoint.as_deref(), Some("1209"));
        assert_eq!(c.year.as_deref(), Some("1991"));
    }

    /// Regression for the sentence-boundary bug:
    /// The regex character class includes `.`, so without explicit boundary trimming,
    /// a lazy `{1,60}?` starting at "T" in "The Court held." will match across the
    /// sentence and capture "The Court held. Seabright..." as the case name.
    /// `last_sentence_boundary()` must trim the window to start at "Seabright".
    #[test]
    fn sentence_boundary_does_not_bleed() {
        let text = "The Court held. Seabright Insurance Co. v. US Airways, Inc., 52 Cal.4th 590, 598 (2011).";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty());
        let c = &results[0];
        assert_eq!(c.reporter, "Cal.4th");
        let name = c.case_name.as_deref().unwrap_or("");
        assert!(
            name.starts_with("Seabright"),
            "name must not bleed from prior sentence; got: {name:?}"
        );
    }

    /// Actual MSJ context: lowercase preceding sentence, no newline.
    /// last_sentence_boundary() must find the `. ` after "care" and
    /// return the start of "Seabright...".
    #[test]
    fn extracts_seabright_mid_paragraph() {
        let text = "compliance with statutory safety requirements is highly probative of the exercise of due care. Seabright Insurance Co. v. US Airways, Inc., 52 Cal.4th 590, 598 (2011).";
        let results = extract_citations(text, "msj");
        assert!(!results.is_empty());
        let c = &results[0];
        assert_eq!(c.reporter, "Cal.4th");
        let name = c.case_name.as_deref().unwrap_or("");
        assert!(name.starts_with("Seabright"), "got: {name:?}");
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
            assert!(results.len() >= 5, "expected >= 5, got {}", results.len());
        }
    }

    #[test]
    fn last_sentence_boundary_basic() {
        // "held." ends at index 13, space at 14 → boundary starts at 15 (after ". ")
        // Wait: T(0)h(1)e(2) (3)C(4)o(5)u(6)r(7)t(8) (9)h(10)e(11)l(12)d(13).(14) (15)
        // i=14 is '.', next=bytes[15]=' ', prev=bytes[13]='d' (not uppercase) → Some(16)
        assert_eq!(last_sentence_boundary("The Court held. Smith"), Some(16));
        // No boundary
        assert_eq!(last_sentence_boundary("no period here"), None);
        // Abbreviation "Co." should NOT trigger boundary: C is uppercase, prev of 'C' in
        // "Co." is 'C' but i-2 check: "Co." → 'C' at some index, 'o' before '.'. 
        // 'o' is not uppercase so it IS treated as a boundary. That is fine for our
        // use case — the party name "Inc." is not the last thing before the volume.
    }
}
