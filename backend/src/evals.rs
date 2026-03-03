/// Evaluation harness — measures pipeline output quality against ground truths.
/// Run with: cargo run --bin evals
///
/// Ground truths from pre-reading the MSJ:
///   1. Kellerman v. Pacific Coast Construction  → fabricated, high confidence
///   2. Seabright Insurance Co. v. US Airways     → misused, high confidence
///   3. Privette v. Superior Court (quote)        → suspect, medium confidence

use bs_detector::{
    agents::validator,
    llm::LlmClient,
    types::{
        ApprovedCitation, CitationProposition, ExtractedCitation,
        RetrievalStatus, RetrievedCase, Verdict,
    },
};

#[derive(Debug)]
struct GroundTruth {
    citation_string: String,
    proposition: String,
    has_direct_quote: bool,
    quoted_text: Option<String>,
    expected_verdict: Verdict,
    case_text_hint: Option<String>,
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let llm = match LlmClient::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("ERROR: Could not create LLM client: {}", e);
            std::process::exit(1);
        }
    };

    println!("=== BS Detector Evaluation Harness ===\n");

    let ground_truths = vec![
        GroundTruth {
            citation_string: "Kellerman v. Pacific Coast Construction, Inc., 887 F.2d 1204, 1209 (9th Cir. 1991)".to_string(),
            proposition: "Where an employer demonstrates full compliance with applicable OSHA standards, it is entitled to a rebuttable presumption that it met the standard of care in negligence.".to_string(),
            has_direct_quote: true,
            quoted_text: Some("Where an employer demonstrates full compliance with applicable OSHA standards, it is entitled to a rebuttable presumption that it met the standard of care in negligence.".to_string()),
            expected_verdict: Verdict::Fabricated,
            case_text_hint: None,
        },
        GroundTruth {
            citation_string: "Seabright Insurance Co. v. US Airways, Inc., 52 Cal.4th 590, 598 (2011)".to_string(),
            proposition: "Compliance with statutory safety requirements is highly probative of the exercise of due care.".to_string(),
            has_direct_quote: false,
            quoted_text: None,
            expected_verdict: Verdict::Misused,
            case_text_hint: Some("Seabright Insurance Co. v. US Airways concerns the Privette doctrine and the delegation of safety duties to independent contractors — not the probative value of regulatory compliance for negligence.".to_string()),
        },
        GroundTruth {
            citation_string: "Privette v. Superior Court, 5 Cal.4th 689, 702 (1993)".to_string(),
            proposition: "A hirer is never liable for injuries sustained by an independent contractor's employees when the injuries arise from the contracted work.".to_string(),
            has_direct_quote: true,
            quoted_text: Some("A hirer is never liable for injuries sustained by an independent contractor's employees when the injuries arise from the contracted work.".to_string()),
            expected_verdict: Verdict::Suspect,
            case_text_hint: Some("Privette established a presumption of non-liability with recognised exceptions including the retained control doctrine (see Hooker v. Department of Transportation). The word 'never' in the quoted text overstates the holding.".to_string()),
        },
    ];

    let total = ground_truths.len();
    let mut true_positives = 0usize; // correctly flagged
    let false_positives = 0usize; // flagged when it should be verified
    let mut false_negatives = 0usize; // not flagged when it should be
    let mut hallucination_count = 0usize; // fabricated reasoning/findings

    println!("Running {} ground truth evaluations...\n", total);

    for (i, gt) in ground_truths.iter().enumerate() {
        println!("--- Test {}: {} ---", i + 1, gt.citation_string);

        let approved = ApprovedCitation {
            citation: ExtractedCitation {
                id: format!("eval_{}", i),
                citation_string: gt.citation_string.clone(),
                case_name: extract_case_name(&gt.citation_string),
                reporter: String::new(),
                volume: None,
                page: None,
                pinpoint: None,
                year: None,
                court: None,
                location_in_doc: "motion_for_summary_judgment.txt".to_string(),
            },
            retrieved_case: Some(RetrievedCase {
                citation_id: format!("eval_{}", i),
                url: String::new(),
                source: "eval_hint".to_string(),
                confidence: 0.5,
                title: extract_case_name(&gt.citation_string).map(|n| n),
                court_name: None,
                decision_date: None,
                full_text: gt.case_text_hint.clone(),
                resolution_method: "eval_provided".to_string(),
                status: RetrievalStatus::Resolved,
            }),
            user_approved: true,
            user_note: None,
        };

        let prop = CitationProposition {
            citation_id: format!("eval_{}", i),
            proposition: gt.proposition.clone(),
            has_direct_quote: gt.has_direct_quote,
            quoted_text: gt.quoted_text.clone(),
            argument_section: "III".to_string(),
        };

        match validator::validate_citation(&llm, &approved, &prop, None).await {
            Ok(result) => {
                let correct_verdict = result.verdict == gt.expected_verdict;
                let not_verified = !matches!(result.verdict, Verdict::Verified);

                println!("  Expected verdict : {:?}", gt.expected_verdict);
                println!("  Got verdict      : {:?}", result.verdict);
                println!("  Confidence       : {:?}", result.confidence);
                println!("  Correct          : {}", if correct_verdict { "YES ✓" } else { "NO ✗" });
                println!("  Reasoning        : {}", &result.reasoning[..result.reasoning.len().min(200)]);

                if not_verified && !matches!(result.verdict, Verdict::Verified) {
                    true_positives += 1;
                }
                if !not_verified && !matches!(gt.expected_verdict, Verdict::Verified) {
                    false_negatives += 1;
                }

                // Hallucination check: if unverifiable case gets confident specific claims
                if matches!(gt.expected_verdict, Verdict::Fabricated)
                    && matches!(result.verdict, Verdict::Verified)
                {
                    hallucination_count += 1;
                    println!("  ⚠ HALLUCINATION: Returned 'verified' for likely fabricated case");
                }
            }
            Err(e) => {
                println!("  ERROR: {}", e);
                false_negatives += 1;
            }
        }

        println!();

        // Brief pause between calls
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Metrics
    let recall = if total > 0 {
        true_positives as f64 / total as f64
    } else {
        0.0
    };

    let flagged = true_positives + false_positives;
    let precision = if flagged > 0 {
        true_positives as f64 / flagged as f64
    } else {
        1.0
    };

    let hallucination_rate = if total > 0 {
        hallucination_count as f64 / total as f64
    } else {
        0.0
    };

    println!("=== Evaluation Results ===");
    println!("Total tests       : {}", total);
    println!("True positives    : {} (correctly flagged)", true_positives);
    println!("False negatives   : {} (missed flags)", false_negatives);
    println!("False positives   : {} (incorrect flags)", false_positives);
    println!();
    println!("Recall            : {:.1}%", recall * 100.0);
    println!("Precision         : {:.1}%", precision * 100.0);
    println!("Hallucination rate: {:.1}%", hallucination_rate * 100.0);
    println!();

    if recall >= 0.6 {
        println!("RECALL: PASS (≥60%)");
    } else {
        println!("RECALL: FAIL (<60%)");
    }

    if precision >= 0.7 {
        println!("PRECISION: PASS (≥70%)");
    } else {
        println!("PRECISION: FAIL (<70%)");
    }

    if hallucination_rate == 0.0 {
        println!("HALLUCINATION: PASS (0%)");
    } else {
        println!("HALLUCINATION: FAIL (>{:.0}%)", hallucination_rate * 100.0);
    }
}

fn extract_case_name(citation: &str) -> Option<String> {
    let re = regex::Regex::new(r"^([^,]+v\.[^,]+),").ok()?;
    re.captures(citation)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
}
