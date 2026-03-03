# Reflection

## What this does

A sequential multi-agent pipeline in Rust/Axum that:
1. Extracts US legal citations deterministically (no LLM)
2. Retrieves full case texts from CourtListener and the Caselaw Access Project
3. Presents cases to the user for approval before any AI validation runs
4. Validates each citation against the actual primary source (Sonnet for propositions, Opus for validation)
5. Cross-references the MSJ's factual assertions against the police report, medical records, and witness statement
6. Maps argument dependencies as a DAG
7. Produces a one-paragraph judicial memo
8. Presents findings in a Collate-style resolution checklist with accept / flag / rerun per item

## Key design decisions

**Deterministic citation extraction.** The CaseKit parser handles US reporter formats without an LLM. This was an obvious improvement — regex is more reliable than a model call for structured citation strings, and failures are explicit rather than silent hallucinations.

**Three-stage pipeline with two user-approval gates.** Citation strings are extracted first. Cases are retrieved and displayed before any AI sees them. Propositions are only extracted after the user confirms the right cases have been found. This means the validator is always checking against a verified primary source, not relying on Claude's training data about what a case holds.

**Sonnet for propositions, Opus for validation.** Proposition extraction is a precise reading task — identify what the motion claims this case supports. Sonnet is well-suited. Validation requires deep legal reasoning against the case text — Opus for this. Haiku was considered for extraction but replaced by the deterministic parser.

**Validation vs. retrieval as separate failure modes.** Kellerman is likely fabricated — retrieval will fail and the validator should flag implausibility. Seabright is real but misused — retrieval succeeds but the validator must know what Seabright actually holds. These require different detection paths. The pipeline handles both: unresolvable retrieval triggers the `fabricated` pathway; resolved retrieval enables doctrinal comparison.

**Human-in-the-loop at every gate.** The judge approves retrieved cases before analysis. The judge reviews every verdict in the checklist. The rerun mechanism means the judge's specific concern is prepended to the validator prompt — the tool responds to judicial expertise rather than replacing it. The export produces a JSON audit trail suitable for appellate purposes.

## What I'd do differently with more time

**CourtListener full-text retrieval is the weakest link.** The CourtListener REST API returns opinion metadata but full text extraction requires a second call to the opinion endpoint. For cases not in CL, CAP provides coverage but the API returns HTML that needs heavier parsing. I'd invest more in robust text extraction — the quality of validation is directly proportional to the quality of the case text fed to Opus.

**Structured citation routing.** Different citation types warrant different retrieval strategies. A 9th Circuit `F.2d` citation should be verified differently than a California `Cal.4th` one. I'd build a router that dispatches to the right source based on reporter code.

**The Privette quote check is the hardest problem.** Detecting "never" as an overstatement of a conditional presumption requires the model to know both the text and the exceptions. In production I'd want the Hooker line of cases pre-indexed so the validator has the full context of the doctrine.

**Eval harness with more ground truths.** Three cases is a minimal eval. I'd want 10-15 citations covering: clean verified citations (precision check), different failure modes, out-of-jurisdiction citations, and string citations without propositions. The hallucination metric needs more coverage — a fabricated citation that happens to resemble a real one is the hard case.

**The consistency check benefits from document preprocessing.** Currently the full text of all documents is sent to Opus. In production I'd extract the SUMF assertions first, then run targeted retrieval within each document for each assertion. This reduces token cost and improves precision.

## What this is not

Not a prediction engine. No outcome scoring. No "you will win / lose" framing. The tool helps the judge see clearly. Every decision remains the judge's.
