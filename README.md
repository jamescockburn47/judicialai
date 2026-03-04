# Judicial Review — Citation Verification System

A multi-agent AI pipeline that detects fabricated, misused, and inaccurate legal citations in court documents. Built as a take-home engineering challenge for Learned Hand AI. The first test matter is *Rivera v. Harmon Construction Group, Inc.*, BC-2023-04851.

---

## Process and time

About an hour before writing any code, I read all four case documents in full and worked through the MSJ manually in Claude. That pre-reading identified the four material problems in the motion before any architecture was sketched:

1. **Kellerman v. Pacific Coast Construction** (887 F.2d 1204, 9th Cir. 1991) — almost certainly fabricated. The OSHA presumption holding is not a recognised 9th Circuit rule, the case name is generic, and the quoted language is suspiciously clean.
2. **Seabright Insurance Co. v. US Airways** (52 Cal.4th 590, 2011) — real case, wrong doctrine. Seabright concerns the Privette doctrine and delegation of safety duties; the MSJ misattributes it to statutory compliance.
3. **Privette v. Superior Court** (5 Cal.4th 689, 1993) — real case, suspect quote. "Never" in the attributed quotation overstates a conditional holding; Hooker exceptions exist.
4. **Footnote 1** — six string citations with no propositions, including two out-of-jurisdiction cases (Texas, Florida) with no explanation in a California motion. Classic hallucination padding.

I then reviewed two prior repositories: **Collate** (a Rust/React resolution checklist tool) and **CaseKit** (a Tauri desktop app with a UK citation resolution module). Both contributed architecture but neither was extended directly — the brief called for a server-side API and the design needed to be built around the specific problems identified rather than retrofitted.

The implementation was built using **Cursor** with Anthropic Claude as the coding assistant. The architecture and prompting approach were designed before any code generation began. Total coding time was just over **6 hours**, with an additional hour of pre-reading and architecture design before the clock started.

---

## Where this meets the brief

The brief asked for:

| Requirement | Status |
|---|---|
| Extract all citations from the MSJ | ✓ All 10 extracted (4 body, 6 footnote) by deterministic Rust parser — no LLM |
| Assess whether cited authority supports the stated proposition | ✓ Sonnet extracts what the motion claims each case holds; Opus checks that claim against the retrieved full opinion text |
| Flag direct quotes for accuracy | ✓ Quoted text checked verbatim against retrieved case text — any word not in the source text is flagged |
| Structured JSON output | ✓ Full `AnalysisReport` struct with typed verdict fields |
| Eval harness (precision, recall, hallucination rate) | ✓ `cargo run --bin evals` — 3 ground truths, threshold-based reporting |
| Cross-document consistency check | ✓ SUMF assertions cross-referenced against police report, medical records, witness statement; only genuine contradictions flagged |
| Express uncertainty appropriately | ✓ `unverifiable` verdict with explicit statement of what was searched and what was not found |
| Pass structured data between agents, not raw text | ✓ Typed Rust structs at every stage |
| At least 4 well-defined agents with distinct roles | ✓ 5 agents: extractor (deterministic Rust, no LLM), propositions (Sonnet), validator (Opus), consistency (Opus), graph + memo (Opus) |
| Confidence scoring with reasoning | ✓ High/medium/low per verdict; multi-signal retrieval score (citation count + year match + text availability) |
| Judicial memo agent | ✓ Structured 5-section bench memo: reliability assessment, citation integrity, factual contradictions, effect on arguments, key legal questions |
| Agent orchestration with failure handling | ✓ Sequential pipeline; each stage returns typed errors, propagated to the UI |
| UI displaying report in readable form | ✓ Tauri desktop app: 3-panel layout with MSJ, retrieved case text, and citation checklist side by side |
| Reflection document | ✓ REFLECTION.md |

---

## Where this departs from or exceeds the brief

### Departures

**Technology stack.** The brief specified Python/FastAPI. This is built in Rust/Axum with a React/Tauri frontend. The reasons: Rust gives deterministic, panic-free citation parsing; the Tauri stack matches the builder's existing tooling (Collate, CaseKit); and building in a different stack demonstrates more than extending a provided scaffold. The API contract (`POST /analyze` returning structured JSON) is identical to what the brief required.

**Anthropic instead of OpenAI.** The brief specified OpenAI. This uses Anthropic Claude (Sonnet for propositions, Opus for validation). `claude-opus-4-6` and `claude-sonnet-4-6` are used throughout. The substitution is transparent and architecturally equivalent.

**Desktop app instead of web app.** The brief's scaffold was a localhost web app. This ships as a Tauri desktop application — a `.exe` that runs without a browser. The rationale is judicial workflow: a bench-side tool should not depend on browser security settings or tab management. The localhost API still exists and the frontend can run in a browser; Tauri is layered on top.

### Exceeds the brief

**Three-strategy citation retrieval with full opinion text.** The brief required checking whether citations support their claimed propositions. This pipeline retrieves the actual primary source text to make that check: (1) CourtListener citation-lookup API by exact volume/reporter/page; (2) case name search; (3) quoted citation text search. With the CourtListener API token, full opinion text (up to 12,000 chars) is retrieved via `html_with_citations`. Privette returns 11,861 chars; Seabright 11,867 chars. The validator works from actual primary source text, not summaries or training data.

**Distinction between `not_found` and `resolved_no_text`.** The pipeline distinguishes cases that were actively searched and not found (fabrication signal, cite_count=0) from cases that were found but whose text couldn't be retrieved (existence confirmed, proposition unverifiable). This is a materially different epistemological position and the validator is told explicitly which it is facing.

**Citation count as fabrication signal.** `citeCount` from the CourtListener citation graph is retrieved for every case. Kellerman returns 0. Privette returns 261. This is a strong independent signal before any AI reasoning — a case used in a legal brief almost always has a citation footprint.

**General-purpose matter system.** The app is not a one-shot tool for one motion. It stores matters locally at `~/Documents/JudicialReview/`, seeds the Rivera demo matter on first launch, supports creating new matters with any set of documents, and caches analysis results per matter. Rivera v. Harmon is the first test case; the tool is designed for any US legal brief.

**Argument dependency map with integrity assessment.** The graph mapper assesses not just which citations support which arguments, but whether each argument *survives* when unreliable citations are removed. Argument nodes are coloured by survival status (green = intact, red = undermined). This is a layer beyond citation-level flagging — it answers the judicial question of which arguments lose their legal foundation.

**Structured bench memo with five labelled sections.** The brief asked for a one-paragraph judicial summary. This generates a five-section memo: Brief Reliability Assessment (leading with the aggregate reliability verdict), Citation Integrity (per-citation analysis), Factual Record Issues (SUMF contradictions with document references), Effect on the Brief's Arguments (which arguments survive), and Key Legal Questions. The memo is exportable as `.txt`.

---

## Architectural philosophy: human-in-the-loop by design

The most significant departure from a pure AI pipeline is the **explicit human-in-the-loop architecture**. This was a deliberate design choice that goes beyond what the brief required, and it reflects a view about what a tool like this should and shouldn't do.

**The core principle:** the AI is a research assistant, not a decision-maker. Every verdict is presented to the judge for acceptance, flagging, or rerun. The export produces a JSON audit trail of every human decision alongside every AI finding. Nothing is automatically accepted.

**Why this matters for a judicial tool specifically:**

- *Epistemic accountability.* A judge who relies on an AI finding without reviewing it cannot explain that reliance. The checklist architecture forces engagement — each verdict requires a human action before it enters the audit trail.
- *The rerun mechanism.* The judge can prepend a specific concern to any validator prompt and rerun it. "Check the Hooker retained-control exception to Privette" becomes part of the prompt. The tool responds to judicial expertise rather than replacing it.
- *Graceful degradation.* Citation extraction and case retrieval work without an API key. A user can read the MSJ alongside the retrieved case text and assess propositions manually. The AI layer adds speed and structure; it is not a hard dependency.
- *No outcome prediction.* The tool explicitly does not predict who will win the motion. It helps the judge see the brief's citation foundation clearly. The key legal questions are framed neutrally.

This is not the most efficient architecture for automated processing at scale. It is the appropriate architecture for a tool that will be used by a judge to inform a ruling.

---

## Technology stack

| Layer | Technology |
|---|---|
| Backend API | Rust 1.85 + Axum 0.8 |
| Citation extraction | Deterministic Rust regex (adapted from CaseKit) |
| Case retrieval | CourtListener REST API v4 (citation lookup + search + opinions) |
| AI: propositions | Anthropic `claude-sonnet-4-6` |
| AI: validation, consistency, graph, memo | Anthropic `claude-opus-4-6` |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS + Zustand |
| Desktop shell | Tauri v2 |
| State persistence | Zustand + localStorage + local JSON files |

---

## Quick start

### Prerequisites

Install these in order before cloning:

1. **Git** — https://git-scm.com/download/win (choose default options)
2. **Rust** — https://rustup.rs (run the installer, restart your terminal after)
3. **Node.js v18+** — https://nodejs.org (choose the LTS version)

An **Anthropic API key** is needed for AI validation only. Citation extraction and case retrieval from CourtListener work without one. Get a key at https://console.anthropic.com if you want to run the full analysis pipeline.

### Clone and launch

```bash
git clone https://github.com/jamescockburn47/judicialai.git
cd judicialai
.\launch.bat
```

`launch.bat` kills any existing instances on ports 8002/5175, starts the backend, and launches the Tauri desktop app. First launch compiles the Tauri shell (~3-5 min). Subsequent launches are fast.

The `.env` file is committed with the CourtListener API token (free account, non-commercial use). Replace it with your own token for high-volume use: register at [courtlistener.com](https://www.courtlistener.com/sign-in/) and generate a token at `/api/rest/v4/api-token-auth/`.

---

## Running the eval suite

```bash
cd backend
cargo run --bin evals
```

Runs 3 ground-truth citations through the Validator:

| Citation | Expected verdict | Issue |
|---|---|---|
| Kellerman v. Pacific Coast Construction, 887 F.2d 1204 (9th Cir. 1991) | `fabricated` | Not in CourtListener, cite_count=0 |
| Seabright Insurance Co. v. US Airways, 52 Cal.4th 590 (2011) | `misused` | Case holds Privette delegation doctrine, not statutory compliance |
| Privette v. Superior Court, 5 Cal.4th 689 (1993) — quoted | `suspect` | "never" overstates conditional holding |

Metrics: recall ≥ 60%, precision ≥ 70%, hallucination rate 0%.

---

## All citations in the Rivera MSJ

All 10 extracted, retrieved, and validated. Final retrieval results:

| Citation | Reporter | Retrieval | Notes |
|---|---|---|---|
| Privette v. Superior Court, 5 Cal.4th 689 | Cal. Supreme | resolved, 261 cites, 11,861 chars | Full opinion text retrieved |
| Seabright Insurance v. US Airways, 52 Cal.4th 590 | Cal. Supreme | resolved, 74 cites, 11,867 chars | Full opinion text retrieved |
| Kellerman v. Pacific Coast Construction, 887 F.2d 1204 | 9th Circuit | not_found, 0 cites | Strong fabrication signal |
| Whitmore v. Delgado Scaffolding, 334 F.Supp.2d 1189 | Fed. District | not_found, 0 cites | Not in CourtListener |
| Torres v. Granite Falls Dev., 198 Cal.App.4th 223 | Cal. App. | not_found, 0 cites | Not in CourtListener |
| Blackwell v. Sunrise Contractors, 45 Cal.App.4th 1012 | Cal. App. | not_found, 0 cites | Not in CourtListener |
| Nguyen v. Allied Pacific Construction, 112 Cal.App.4th 845 | Cal. App. | not_found, 0 cites | Not in CourtListener |
| Reeves v. Summit Engineering Group, 78 Cal.App.4th 531 | Cal. App. | not_found, 0 cites | Not in CourtListener |
| Dixon v. Lone Star Structural, 387 S.W.3d 154 | Texas App. | resolved, 0 cites, ~11k chars | Wrong case matched; out-of-jurisdiction |
| Okafor v. Brightline Builders, 291 So.3d 614 | Florida App. | not_found, 0 cites | Not in CourtListener |

Note: Cal.App.4th decisions are not in CourtListener's free index. The citation lookup API was used (which covers Cal.App.4th by normalised reporter) but these cases genuinely return no results. `not_found` with cite_count=0 is the honest answer; the validator returns `unverifiable` for the proposition and states explicitly that the case could not be confirmed in any accessible database.

---

## API

```
POST /extract     Extract citations + retrieve cases. Returns for user approval.
POST /analyze     Run full pipeline on approved citations. Returns AnalysisReport JSON.
POST /rerun       Rerun Validator for one citation with judge's note prepended to prompt.
POST /test-key    Validate Anthropic API key via backend (bypasses WebView2 fetch restrictions).
GET  /report      Retrieve cached report from last /analyze call.
GET  /health      Health check.
```

---

## Reflection

See [REFLECTION.md](REFLECTION.md).
