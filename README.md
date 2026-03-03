# BS Detector

A multi-agent AI pipeline that detects fabricated, misused, and inaccurate legal citations in court documents. Built as a take-home engineering challenge for Learned Hand AI.

**Test case:** *Rivera v. Harmon Construction Group, Inc.*, BC-2023-04851 — Defendant's Motion for Summary Judgment

---

## Process

About an hour before writing any code, I read all four documents in full and worked through the MSJ by hand in Claude. That pre-reading identified the four material problems in the motion before a single line of architecture was sketched:

1. **Kellerman v. Pacific Coast Construction** (887 F.2d 1204, 9th Cir. 1991) — almost certainly fabricated. The holding — that OSHA compliance creates a rebuttable presumption of reasonable care in negligence — is not a recognised 9th Circuit rule, the case name is generic, and the quoted language is suspiciously clean.
2. **Seabright Insurance Co. v. US Airways** (52 Cal.4th 590, 2011) — real case, wrong doctrine. The MSJ uses it to support statutory compliance as probative of due care. Seabright actually concerns the Privette doctrine and delegation of safety duties to independent contractors.
3. **Privette v. Superior Court** (5 Cal.4th 689, 1993) — real case, suspect quote. The word "never" in the attributed quotation overstates the holding; the Hooker line of cases establishes recognised exceptions.
4. **Footnote 1** — six string citations with no propositions, including two out-of-jurisdiction cases (*Dixon v. Lone Star Structural* (Tex. App.) and *Okafor v. Brightline Builders* (Fla. Dist. Ct. App.)) cited without explanation in a California motion. Classic hallucination-padding: bulk citations that create an appearance of doctrinal depth but add nothing to a California negligence argument.

That pre-reading shaped every architecture decision that followed.

I then reviewed my existing repositories to assess what could be reused. Two were relevant:

- **Collate** (`github.com/legalquant/Collate`) — a Rust/WASM + React litigation tool built around a resolution checklist interaction model. The core mechanic — a lawyer reviews each flagged item and accepts, rejects, or defers with a note — maps directly onto judicial citation review.
- **CaseKit** (`github.com/legalquant/casekit`) — a Tauri desktop app for civil litigants that includes a citation resolution module. The module queries BAILII and Find Case Law (UK sources) using a five-strategy cascade with confidence scoring. The architecture is directly portable; only the source endpoints needed to change from UK to US databases.

I decided to build from scratch rather than extend either codebase, for two reasons: the scope of the brief called for a server-side API rather than a client-side tool, and building fresh allowed the architecture to be designed specifically around the four identified problems rather than retrofitted to an existing UI.

I used Cursor to scaffold and generate the implementation, directing it with the architectural brief and the pre-analysis of the MSJ. The architecture was designed before any prompting began.

---

## Architecture

The pipeline runs sequentially. Each stage only runs after the user confirms the previous stage. The AI never sees a case text the user has not first reviewed.

```
[Deterministic Rust parser]    →  Citation strings extracted from MSJ
         ↓                         No LLM. CaseKit citation patterns adapted to US reporters.
[CourtListener / CAP APIs]     →  Full case texts fetched from public US databases
         ↓
  [User approval gate]         →  Cases displayed for verification before any AI call
         ↓
[Sonnet claude-sonnet-4-5]     →  Propositions extracted per citation from the MSJ
         ↓
[Opus claude-opus-4-5]         →  Validator: case text + proposition → verdict + reasoning
         ↓
[Opus claude-opus-4-5]         →  Consistency: SUMF assertions cross-referenced against
                                   police report, medical records, witness statement
         ↓
[Opus claude-opus-4-5]         →  Graph mapper: argument dependency DAG
         ↓
[Opus claude-opus-4-5]         →  Judicial memo: one paragraph for the judge
         ↓
  [Collate-style checklist]    →  Accept / Flag / Rerun per item. Export audit trail.
```

**Verdict types returned by the Validator:**

| Verdict | Meaning |
|---------|---------|
| `verified` | Case supports the stated proposition |
| `suspect` | Arguable support, but proposition is overstated, taken out of context, or relies on dicta |
| `misused` | Case is real but holds something materially different |
| `fabricated` | Case likely does not exist; combination of name, reporter, and holding is implausible |
| `unverifiable` | Case text not retrieved; assessed for plausibility only |

---

## Design decisions

**Human verification before AI validation.** The approval gate between retrieval and validation is the most important design choice. The pipeline retrieves the full case text and displays it to the user before Opus sees it. The user can confirm the right case was found, substitute a corrected citation, or mark it unverifiable. This means the validator always works from a primary source the user has reviewed — not from Claude's training data about what a case holds.

This also means the tool degrades gracefully if the AI is unavailable. Citation strings are extracted deterministically. Cases are retrieved and displayed from public databases. A user can read the case text and assess the proposition manually, without running the AI pipeline at all. The AI layer adds speed and structure; it is not a dependency for the core verification task.

**Deterministic citation extraction.** A Rust regex parser adapted from CaseKit handles US reporter formats (`F.2d`, `F.3d`, `F.4th`, `F.Supp.2d/3d`, `Cal.4th/5th`, `S.W.3d`, `So.3d`, `N.Y.3d`, etc.). No LLM call at this stage. Pattern matching is more reliable than a model call for structured strings, and failures are explicit rather than silent.

**Sonnet for propositions, Opus for validation.** Proposition extraction is a reading task — identify what the motion claims each case supports. Sonnet is sufficient. Validation requires legal reasoning against retrieved case text — comparing the claimed proposition to what the case actually holds. Opus for this.

**Fabrication and misuse are different detection problems.** Kellerman needs retrieval failure to trigger the fabricated pathway. Seabright needs the model to know what Seabright actually holds and compare it to the claimed proposition. The pipeline handles both: unresolvable retrieval routes to fabrication assessment; resolved retrieval enables doctrinal comparison. These cannot be collapsed into a single detection step.

**The judge makes every decision.** No prediction of outcome. No confidence score that collapses to a recommendation. The rerun mechanism means the judge's specific concern is prepended to the Validator prompt — the tool responds to judicial expertise. The export produces a full JSON audit trail: every citation, every verdict, every human decision, every rerun.

**Scope.** This is a scoped tool for a well-defined document. The citations to check are known and bounded. I made a deliberate decision not to build extensive edge-case handling for citation formats that do not appear in the MSJ — the test case establishes the scope, and engineering time was better spent on the depth of each pipeline stage than the breadth of citation coverage.

---

## Quick Start

### Desktop App (Tauri dev mode — recommended)

Requires Rust and Node installed.

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
```

Then double-click `launch.bat` (or run `launch.ps1`). This starts:
- The Rust/Axum backend on `http://localhost:8002`
- The Vite dev server on `http://localhost:5175` (browser preview)

To run the full Tauri desktop window (no browser):
```bash
cd frontend
npm run tauri:dev
```

### Browser-only dev

```bash
# Terminal 1
cd backend && cargo run --bin bs-detector

# Terminal 2
cd frontend && npm run dev
# Open http://localhost:5175
```

---

## Running the Eval Suite

```bash
cd backend
cargo run --bin evals
```

Three ground-truth citations are run through the Validator with known expected verdicts:

| Citation | Expected | Issue |
|----------|----------|-------|
| Kellerman v. Pacific Coast Construction, 887 F.2d 1204 (9th Cir. 1991) | `fabricated` | OSHA presumption holding unverifiable in 9th Circuit |
| Seabright Insurance Co. v. US Airways, 52 Cal.4th 590 (2011) | `misused` | Case holds Privette delegation doctrine, not statutory compliance |
| Privette v. Superior Court, 5 Cal.4th 689 (1993) — quoted | `suspect` | "never" overstates holding; Hooker exceptions exist |

**Metrics reported:**

| Metric | Description | Pass threshold |
|--------|-------------|----------------|
| Recall | % of known bad citations correctly flagged | ≥ 60% |
| Precision | % of flags that are genuine issues | ≥ 70% |
| Hallucination rate | % of fabricated citations returned as verified | 0% |

The thresholds are honest. Three cases is a minimal eval set. A pipeline that catches 2 of 3 known problems and fabricates no findings is more useful than one that claims 100% on cherry-picked tests.

---

## All Citations in the MSJ

The parser extracts all 10 citations from the motion — 4 in the body, 6 in footnote 1. All 10 are retrieved and displayed for user approval before any AI validation runs.

**Body**

| Citation | Reporter | Known issue |
|----------|----------|-------------|
| Privette v. Superior Court, 5 Cal.4th 689 (1993) | Cal. Supreme | Suspect quote — "never" overstates holding with existing exceptions |
| Whitmore v. Delgado Scaffolding Co., 334 F. Supp. 2d 1189 (C.D. Cal. 2004) | Federal District | Proposition plausible; requires retrieval to verify |
| Kellerman v. Pacific Coast Construction, Inc., 887 F.2d 1204 (9th Cir. 1991) | 9th Circuit | Almost certainly fabricated |
| Seabright Insurance Co. v. US Airways, Inc., 52 Cal.4th 590 (2011) | Cal. Supreme | Misused — case holds Privette delegation doctrine, not regulatory compliance |

**Footnote 1 — string citations, no proposition stated**

| Citation | Reporter | Known issue |
|----------|----------|-------------|
| Torres v. Granite Falls Dev. Corp., 198 Cal.App.4th 223 (2011) | Cal. App. | California; plausibility to be verified |
| Blackwell v. Sunrise Contractors, Inc., 45 Cal.App.4th 1012 (1996) | Cal. App. | California; plausibility to be verified |
| Dixon v. Lone Star Structural, LLC, 387 S.W.3d 154 (Tex. App. 2012) | Texas App. | Out-of-jurisdiction — Texas authority cited in a California motion with no explanation |
| Okafor v. Brightline Builders, Inc., 291 So.3d 614 (Fla. Dist. Ct. App. 2019) | Florida App. | Out-of-jurisdiction — Florida authority cited in a California motion with no explanation |
| Nguyen v. Allied Pacific Construction Co., 112 Cal.App.4th 845 (2003) | Cal. App. | California; plausibility to be verified |
| Reeves v. Summit Engineering Group, 78 Cal.App.4th 531 (2000) | Cal. App. | California; plausibility to be verified |

The footnote citations carry no stated proposition — they are string citations attached to footnote 1, which is anchored to the Seabright sentence. The two out-of-jurisdiction cases (Texas, Florida) are cited in a California motion with no showing that foreign authority applies. This is a classic hallucination-padding pattern: bulk citations that create an appearance of doctrinal depth but add no legal substance to a California negligence motion.

---

## API

```
POST /extract     Extract citations + retrieve case texts. Returns for user approval.
POST /analyze     Run full pipeline on approved citations. Returns AnalysisReport JSON.
POST /rerun       Rerun Validator for one citation with judge's note prepended.
GET  /report      Retrieve cached report from last /analyze call.
GET  /health      Health check.
```

---

## Known Limitations

- CourtListener coverage is strong for federal courts; California state appellate decisions are well-indexed but some trial court records are not.
- The Caselaw Access Project (Harvard) provides secondary coverage but full-text retrieval requires parsing the API's HTML response.
- Google Scholar fallback is not implemented in v0.1 due to rate-limiting constraints.
- The Privette quote check depends on the retrieved case text containing the verbatim passage at the relevant page.
- The consistency check sends full document texts to Opus. In production, SUMF assertions would be extracted first and retrieval run per-assertion to reduce token cost.

---

## Reflection

See [REFLECTION.md](REFLECTION.md).
