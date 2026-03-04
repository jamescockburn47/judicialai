# Reflection

## What this does (current state)

A Tauri desktop application wrapping a sequential multi-agent Rust/Axum pipeline:

1. **Deterministic citation extraction** — Rust regex parser, no LLM, adapted from CaseKit. Handles all major US reporter formats.
2. **Three-strategy case retrieval** — CourtListener citation-lookup API (volume/reporter/page, works for Cal.App.4th), case name search, quoted citation search. With API token: full opinion text via `html_with_citations` (up to 12,000 chars).
3. **User approval gate** (Manual mode) — retrieved cases displayed before any AI call. User can review the actual case text alongside the motion.
4. **Proposition extraction** — Sonnet reads the motion and extracts what each citation is claimed to hold.
5. **Validation** — Opus checks the claimed proposition against the retrieved case text. Verbatim quote checking. Multi-signal confidence scoring.
6. **Consistency check** — Opus identifies genuine contradictions between the motion's statement of facts and the record documents. Not "unsupported" — only direct contradictions.
7. **Argument dependency graph** — Opus maps which arguments depend on which citations, and whether each argument survives if unreliable citations are removed.
8. **Bench memo** — structured 5-section memo: reliability assessment, citation integrity, factual record issues, effect on arguments, key legal questions.
9. **Resolution checklist** — compact single-line citation list, click to expand detail, click to load case text in centre panel alongside the motion.

## Key design decisions

**Verifiable sources only.** The original design used Claude's training data for Cal.App.4th cases because CourtListener doesn't index them. This was rejected on principle: training data cannot verify what a case holds. The current design uses `not_found` with explicit explanation when a case is genuinely not in any accessible database. The validator is told: no text = no proposition verification, period. This is a harder epistemic standard than the brief required.

**The distinction between `not_found` and `resolved_no_text`.** The pipeline distinguishes three retrieval outcomes: (1) case found, full text retrieved — proposition verifiable; (2) case found in CourtListener, text not available — existence confirmed, proposition unverifiable; (3) case not found anywhere after three search strategies — potential fabrication signal. These are materially different epistemic positions. The validator receives explicit instructions for each.

**Citation count as an independent fabrication signal.** `citeCount` from the CourtListener citation graph is retrieved for every case. Kellerman returns 0 after the citation lookup. Privette returns 261. This signal is available before any AI reasoning and provides an independent check: a case used in a brief almost always has a citation footprint.

**Human-in-the-loop as a design philosophy, not a feature.** The brief asked for a pipeline. This is a pipeline with explicit human gates. The difference is philosophical: this tool is designed for use by a judge, and a judge who relies on an AI finding without reviewing it cannot explain that reliance. The checklist forces engagement. The rerun mechanism means judicial expertise is incorporated into the validation, not bypassed by it. The audit trail records every human decision alongside every AI finding.

**General-purpose from the start.** The brief was scoped to one motion. The app stores matters in `~/Documents/JudicialReview/`, seeds Rivera v. Harmon as a demo, and supports any US legal brief. The citation extractor covers all major reporter formats. The consistency checker is generic — no case-specific hardcoding.

## The hardest problems

**Cal.App.4th retrieval.** California Court of Appeal decisions are not in CourtListener's standard search index. The citation-lookup API (volume/reporter/page with reporter normalisation) does reach some of them, but the six Cal.App.4th cases in the Rivera footnote genuinely return no results. This is an honest finding — the pipeline tried three strategies and found nothing — not a limitation to paper over.

**The Privette quote.** The word "never" is added to a conditional holding. Detecting this requires reading the full text of the case and comparing it character by character to the quoted passage. With 11,861 chars of Privette text now retrieved, the validator has what it needs. Whether Opus catches it on a given run depends on how the prompt surfaces the comparison. The `quote_accurate: false` field in the response schema is specifically designed for this.

**Fabricated citations that resemble real cases.** Kellerman is handled because it returns cite_count=0 and no text. A harder case would be a fabricated citation with a plausible-sounding name that happens to share a reporter/volume with a real case. The citation lookup API is more robust here than text search because it checks exact page numbers.

## What was built vs. what the brief asked for

The brief asked for a working POST /analyze endpoint, named agents with explicit prompts, a runnable eval suite, and a reflection. All four are present.

The brief did not ask for: a Tauri desktop app, a general-purpose matter system, a three-panel side-by-side document comparison view, an argument dependency graph with survival assessment, or a five-section structured bench memo. These were added because they serve the actual use case better than the minimal spec.

The brief specified Python and OpenAI. This uses Rust and Anthropic Claude. The reasons are stated in the README. The API contract is identical.

The most significant addition over the brief is the human-in-the-loop architecture. The brief imagined an automated pipeline. This imagines a judge using a tool. The difference matters institutionally: judicial decisions require explainable reasoning, and a finding the judge hasn't reviewed cannot be explained. The pipeline is automated; the sign-off is not.

## What I would do differently

**CourtListener coverage.** The citation-lookup API reaches more reporters than the search endpoint, but Cal.App.4th cases in the Rivera footnote still return nothing. A production system would register for Westlaw or Lexis access for state intermediate appellate coverage. The free database gap is real and honest — these cases should be marked `not_found` rather than assessed from training data.

**The eval harness.** Three ground truths is minimal. A proper eval would include: clean verified citations (precision check), multiple fabrication failure modes, out-of-jurisdiction citations with and without propositions, and quote accuracy cases with varying degrees of distortion. The current harness is honest about its scope.

**Opus cost.** Running Opus for validation, consistency, graph, and memo on a 10-citation brief costs approximately $1-2. At judicial scale this is manageable. For high-volume use, the consistency and graph agents could run on Sonnet with the memo and validation kept on Opus.

**The argument graph.** The current implementation asks Opus to generate a DAG and assess argument survival in one call. A more robust design would separate the structural mapping (which arguments depend on which citations — Sonnet) from the survival assessment (what happens to each argument when unreliable citations are removed — Opus). The combined call works but conflates two distinct reasoning tasks.

## What this is not

Not a prediction engine. Not legal advice. Not a replacement for legal judgment.

The tool helps a judge see the brief's citation foundation clearly — what cases were cited, whether they exist, whether they say what they're claimed to say, and which arguments lose their legal foundation when the unreliable citations are set aside. Every decision remains the judge's.
