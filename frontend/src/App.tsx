import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listMatters, saveAnalysisCache, loadAnalysisCache, readDocument } from './matters';
import { extractCitations, analyzeDocument, rerunCitation } from './api';
import { getApiKey } from './keystore';
import type { AnalyzeRequest, Matter, RetrievedCase } from './types';
import { MatterSidebar } from './components/MatterSidebar';
import { CitationReviewPanel } from './components/CitationReviewPanel';
import { ArgumentDAG } from './components/ArgumentDAG';
import { DetailPanel } from './components/DetailPanel';
import { ResolutionChecklist } from './components/ResolutionChecklist';
import { ApiKeySettings } from './components/ApiKeySettings';
import { ModeToggle } from './components/ModeToggle';
import { VerdictBadge } from './components/VerdictBadge';
import './index.css';

// ── Document viewer with citation highlighting ────────────────────────────────

function DocumentViewer({
  matter,
  filename,
  citationStrings,
  onExtract,
  canExtract,
  extracting,
}: {
  matter: Matter;
  filename: string;
  citationStrings: string[];
  onExtract: () => void;
  canExtract: boolean;
  extracting: boolean;
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const isPrimary = filename === matter.primaryDocument;

  useEffect(() => {
    if (!filename) return;
    setLoading(true);
    readDocument(matter, filename)
      .then(setText)
      .finally(() => setLoading(false));
  }, [matter.id, filename]);

  const renderHighlighted = () => {
    if (!text) return null;
    if (citationStrings.length === 0) {
      return (
        <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
          {text}
        </pre>
      );
    }
    const escaped = citationStrings
      .filter(Boolean)
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escaped.length === 0) {
      return (
        <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
          {text}
        </pre>
      );
    }
    const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
    const parts = text.split(pattern);
    return (
      <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
        {parts.map((part, i) =>
          citationStrings.includes(part) ? (
            <mark key={i} className="bg-amber-200 text-amber-900 rounded px-0.5">
              {part}
            </mark>
          ) : (
            part
          ),
        )}
      </pre>
    );
  };

  const DOC_LABELS: Record<string, string> = {
    'motion_for_summary_judgment.txt': 'Motion for Summary Judgment',
    'police_report.txt': 'Police Report',
    'medical_records_excerpt.txt': 'Medical Records',
    'witness_statement.txt': 'Witness Statement',
  };

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">
      <div className="px-4 py-2.5 border-b border-slate-200 shrink-0 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
            {isPrimary ? 'Primary Document' : 'Supporting Document'}
          </p>
          <p className="text-sm font-semibold text-slate-800">{DOC_LABELS[filename] ?? filename}</p>
        </div>
        {isPrimary && canExtract && (
          <button
            onClick={onExtract}
            disabled={extracting}
            className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {extracting ? 'Extracting...' : 'Extract Citations'}
          </button>
        )}
        {citationStrings.length > 0 && (
          <span className="text-[10px] text-amber-700 bg-amber-100 rounded px-1.5 py-0.5 shrink-0">
            {citationStrings.length} highlighted
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs text-slate-400 animate-pulse">Loading...</p>
        ) : (
          renderHighlighted()
        )}
      </div>
    </div>
  );
}

// ── Bench Memo Panel ──────────────────────────────────────────────────────────

function MemoPanel({ memo, matterId }: { memo: string; matterId: string }) {
  const [expanded, setExpanded] = useState(true);

  const exportMemo = () => {
    const blob = new Blob([memo], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bench-memo-${matterId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lines = memo.split('\n');

  return (
    <div className="bg-indigo-950 text-indigo-100 px-5 shrink-0 border-b border-indigo-900">
      {/* Header row */}
      <div className="flex items-center justify-between py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-indigo-400 hover:text-white text-[10px] font-semibold uppercase tracking-wide"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          Bench Memo
        </button>
        <div className="flex items-center gap-2">
          {!expanded && (
            <p className="text-indigo-300 text-[10px] italic truncate max-w-xs">
              {lines.find(l => l.trim())?.slice(0, 80)}…
            </p>
          )}
          <button
            onClick={exportMemo}
            className="text-[10px] text-indigo-400 hover:text-white border border-indigo-800 hover:border-indigo-500 rounded px-2 py-0.5 transition-colors"
          >
            Export
          </button>
        </div>
      </div>

      {/* Structured content */}
      {expanded && (
        <div className="pb-3 text-xs space-y-0.5 max-h-64 overflow-y-auto">
          {lines.map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={i} className="h-1.5" />;
            // Section heading: ALL CAPS word(s) followed by colon
            const isHeading = /^[A-Z][A-Z\s]{2,}:/.test(trimmed);
            if (isHeading) {
              return (
                <p key={i} className="text-indigo-300 font-semibold text-[10px] uppercase tracking-wide pt-2">
                  {trimmed}
                </p>
              );
            }
            return (
              <p key={i} className="text-indigo-100 leading-relaxed">{trimmed}</p>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Case Text Panel ───────────────────────────────────────────────────────────

function CaseTextPanel({
  retrieved,
}: {
  retrieved: RetrievedCase;
  onBack?: () => void;
}) {
  const hasFullText = retrieved.full_text && retrieved.full_text.length > 200;
  const textSource = hasFullText
    ? (retrieved.resolution_method?.includes('pdf') || retrieved.full_text!.length > 1000
        ? 'Full opinion text (PDF)'
        : 'Snippet only')
    : null;

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">
      <div className="px-4 py-2.5 border-b border-slate-200 shrink-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800 truncate">
            {retrieved.title ?? 'Retrieved case'}
          </p>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 flex-wrap">
            {retrieved.court_name && <span>{retrieved.court_name}</span>}
            {retrieved.decision_date && <span>· {retrieved.decision_date}</span>}
            {retrieved.cite_count !== null && retrieved.cite_count !== undefined && (
              <span className={retrieved.cite_count === 0 ? 'text-red-600 font-medium' : ''}>
                · {retrieved.cite_count === 0 ? '⚠ 0 citations in graph' : `${retrieved.cite_count} citations`}
              </span>
            )}
            {textSource && (
              <span className="bg-slate-100 px-1.5 py-0.5 rounded">{textSource}</span>
            )}
            {retrieved.url && (
              <a href={retrieved.url} target="_blank" rel="noopener noreferrer"
                className="text-indigo-500 hover:underline">Open source ↗</a>
            )}
          </div>
        </div>
      </div>      <div className="flex-1 overflow-y-auto p-4">
        {hasFullText ? (
          <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
            {retrieved.full_text}
          </pre>
        ) : (
          <div className="text-sm text-slate-500 space-y-2">
            <p className={`font-medium ${retrieved.status === 'not_found' ? 'text-red-700' : retrieved.status === 'not_indexed' ? 'text-slate-700' : 'text-slate-600'}`}>
              {retrieved.status === 'not_found'
                ? 'Not found in CourtListener'
                : retrieved.status === 'not_indexed'
                ? 'Not in CourtListener\'s free index'
                : 'Full text not available'}
            </p>
            <p className="text-xs leading-relaxed">
              {retrieved.status === 'not_found'
                ? `Searched CourtListener but found no matching case. Citation count: ${retrieved.cite_count ?? 'unknown'}. A real case used in a brief almost always appears in citation databases — this is a strong fabrication signal.`
                : retrieved.status === 'not_indexed'
                ? `California Court of Appeal decisions (${retrieved.resolution_method.includes('Cal.App') ? 'Cal.App.4th/5th' : 'this reporter series'}) are not in CourtListener's free database. This is not a fabrication signal — these are legitimate published decisions.`
                : 'The case was found but full opinion text could not be retrieved.'}
            </p>
            {retrieved.status === 'not_indexed' && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700">
                <p className="font-medium mb-0.5">AI assessment method</p>
                <p>The validator assessed this citation using Claude's training knowledge of California appellate decisions, rather than retrieved text. The verdict reflects the plausibility of the claimed proposition based on known case law.</p>
              </div>
            )}
            <p className="text-[10px] text-slate-400 font-mono">{retrieved.resolution_method}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Help Panel ────────────────────────────────────────────────────────────────

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-end p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md h-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-sm font-semibold text-slate-900">How to use Judicial Review</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-xs text-slate-700 space-y-4">

          <section>
            <h3 className="font-semibold text-slate-900 mb-1 text-sm">What this tool does</h3>
            <p className="leading-relaxed text-slate-600">
              Judicial Review detects fabricated, misused, and inaccurate legal citations in court documents.
              It extracts citations from a motion, retrieves the actual cases from CourtListener,
              and uses Claude (Opus) to check whether each case actually supports the proposition claimed.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">The pipeline</h3>
            <ol className="space-y-2 list-decimal pl-4">
              <li><span className="font-medium">Extract citations</span> — click the button on the primary document. Runs a deterministic Rust parser (no API key needed). Supports all major US reporter formats (Federal Reporter, Cal., N.Y., Tex., Fla., etc.).</li>
              <li><span className="font-medium">Case retrieval</span> — each citation is searched in CourtListener. Where found, the full opinion text is retrieved. The citation count (how many other decisions cite this case) is a key fabrication signal: 0 citations in a well-indexed court = likely fabricated.</li>
              <li><span className="font-medium">Choose mode</span>
                <ul className="mt-1 space-y-0.5 pl-3 list-disc text-slate-600">
                  <li><span className="font-medium">Auto</span> — pipeline runs end to end automatically</li>
                  <li><span className="font-medium">Manual</span> — you review retrieved cases and approve before analysis runs</li>
                </ul>
              </li>
              <li><span className="font-medium">Analysis</span> — Claude Sonnet extracts what the brief claims each case holds. Claude Opus checks that claim against the retrieved case text and flags quote inaccuracies. Supporting documents are cross-referenced against the motion's statement of facts.</li>
              <li><span className="font-medium">Review results</span> — three tabs: Bench Memo, Citation Review, Argument Map.</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">Verdict types</h3>
            <dl className="space-y-1.5">
              <div><dt className="inline font-medium text-red-700">Fabricated — </dt><dd className="inline text-slate-600">Case does not appear to exist in any indexed database. Citation count is 0 and no text retrieved. Strong indicator of AI hallucination in the brief.</dd></div>
              <div><dt className="inline font-medium text-orange-700">Misused — </dt><dd className="inline text-slate-600">Case is real but holds something materially different from the attributed proposition. Doctrinal transplant.</dd></div>
              <div><dt className="inline font-medium text-amber-700">Suspect — </dt><dd className="inline text-slate-600">Case may support the proposition but it is overstated, taken out of context, or a direct quote has been modified.</dd></div>
              <div><dt className="inline font-medium text-emerald-700">Verified — </dt><dd className="inline text-slate-600">Case found, supports the stated proposition, quote (if any) is accurate.</dd></div>
              <div><dt className="inline font-medium text-slate-600">Unverifiable — </dt><dd className="inline text-slate-600">Full text not retrieved and citation count unavailable. Cannot assess — noted, not assumed clean.</dd></div>
            </dl>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">Accept / Flag / Rerun</h3>
            <dl className="space-y-1.5">
              <div><dt className="inline font-medium text-emerald-700">Accept — </dt><dd className="inline text-slate-600">You agree with the AI verdict on this citation. Recorded in the audit trail.</dd></div>
              <div><dt className="inline font-medium text-amber-700">Flag — </dt><dd className="inline text-slate-600">You disagree or want to note a concern. Add a note and click Flag. Recorded in the audit trail.</dd></div>
              <div><dt className="inline font-medium text-indigo-700">Rerun — </dt><dd className="inline text-slate-600">Add a specific instruction (e.g. "check whether this court recognised exceptions to the general rule") and click Rerun. The validator reruns with your note prepended. Use this to direct the AI to examine a specific concern.</dd></div>
            </dl>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">Viewing retrieved cases</h3>
            <p className="leading-relaxed text-slate-600">
              In Citation Review, click the ⬚ icon on any row to load the retrieved opinion into the centre panel.
              The primary document remains visible on the left — you can compare the brief against the actual case text directly.
            </p>
            <p className="mt-1 leading-relaxed text-slate-600">
              <span className="font-medium">Not indexed in CourtListener</span> — this is not a fabrication signal.
              Many legitimate state intermediate appellate decisions (e.g. Cal.App.4th, N.Y.A.D.) are not in CourtListener's free index.
              The AI assesses plausibility from citation details and legal context.
              <span className="font-medium ml-1">Not found</span> — searched and absent — is a fabrication signal.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">Export Audit Trail</h3>
            <p className="leading-relaxed text-slate-600">
              The Export button produces a JSON file containing every citation, every AI verdict, every human decision,
              and every rerun with its note. Suitable for appellate record purposes.
              The bench memo can be exported separately as a .txt file from the Bench Memo tab.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-slate-900 mb-1.5 text-sm">Limitations</h3>
            <ul className="space-y-1 list-disc pl-4 text-slate-600">
              <li>State intermediate appellate decisions (Cal.App.4th, N.Y.S., etc.) are not indexed in CourtListener — these return as "not indexed", not fabricated.</li>
              <li>Unpublished decisions and very old cases may also be absent — absence is not evidence of fabrication.</li>
              <li>AI semantic analysis can miss nuance. The Rerun mechanism is specifically designed for you to direct the AI to examine specific concerns.</li>
              <li>This tool assists citation verification. It does not constitute legal advice and does not replace independent legal judgment.</li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const {
    matters, setMatters,
    activeMatter, setActiveMatter,
    mode, setMode,
    stage, setStage,
    citations, retrievedCases, setCitationsAndCases,
    approvedCitations, approveCitation, rejectCitation, approveAll,
    report, setReport,
    checklist, updateChecklistItem,
    selectedNodeId, setSelectedNodeId,
    error, setError,
    resetPipeline,
  } = useAppStore();

  const [running, setRunning] = useState(false);
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [activeDocFilename, setActiveDocFilename] = useState<string>('');
  const [activeResultTab, setActiveResultTab] = useState<'memo' | 'checklist' | 'dag'>('memo');
  // Left panel: 'msj' | 'doc:<filename>' | 'case:<citation_id>'
  const [leftPanel, setLeftPanel] = useState<string>('msj');
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);

  useEffect(() => {
    listMatters().then(setMatters).catch(console.error);
    getApiKey().then((k) => setHasApiKey(!!k));
  }, []);

  useEffect(() => {
    if (activeMatter) {
      setActiveDocFilename(activeMatter.primaryDocument);
      resetPipeline();
    }
  }, [activeMatter?.id]);

  useEffect(() => {
    if (!activeMatter) return;
    loadAnalysisCache(activeMatter).then((cache) => {
      if (cache) {
        setReport(cache.report);
        setMode(cache.mode);
        setStage('review');
      }
    }).catch(console.error);
  }, [activeMatter?.id]);

  // ── Extract citations (no API key needed) ────────────────────────────────────
  const runExtract = async (matter: Matter) => {
    setRunning(true);
    setError(null);
    setStage('extracting');
    try {
      const extracted = await extractCitations(matter.primaryDocument, matter.documentsPath);
      setCitationsAndCases(extracted.citations, extracted.retrieved_cases);
      setStage('approval'); // show citation review panel regardless of mode
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Extraction failed');
      setStage('idle');
    } finally {
      setRunning(false);
    }
  };

  // ── Run analysis (API key required) ─────────────────────────────────────────
  const runAnalysis = async (matter: Matter) => {
    const toAnalyze = mode === 'auto'
      ? citations.map((c) => ({
          citation: c,
          retrieved_case: retrievedCases.find((r) => r.citation_id === c.id) ?? null,
          user_approved: true,
          user_note: null,
        }))
      : approvedCitations;

    if (toAnalyze.length === 0) {
      setError('No citations to analyse. Approve at least one citation first.');
      return;
    }
    if (!hasApiKey) {
      setShowKeySettings(true);
      setError('API key required for analysis. Set your key and try again.');
      return;
    }

    setRunning(true);
    setError(null);
    setStage('analyzing');
    try {
      const body: AnalyzeRequest = {
        approved_citations: toAnalyze,
        document_name: matter.primaryDocument,
        documents_path: matter.documentsPath || undefined,
      };
      const result = await analyzeDocument(body);
      setReport(result);
      await saveAnalysisCache(matter, mode, result);
      setStage('review');
      setActiveResultTab('memo');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setStage('approval');
    } finally {
      setRunning(false);
    }
  };

  const handleModeChange = (m: typeof mode) => {
    if (stage === 'analyzing') return;
    setMode(m);
  };

  const handleMatterCreated = (m: Matter) => {
    setMatters([...matters, m].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setActiveMatter(m);
  };

  // Citation strings for highlighting (just the core volume+reporter+page)
  const citationHighlights = citations.map((c) => {
    const m = c.citation_string.match(/\d+\s+\S+(?:\s+\S+)?\s+\d+/);
    return m ? m[0] : '';
  }).filter(Boolean);

  const isReview = stage === 'review' && !!report;

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
      {/* Top bar */}
      <header className="bg-slate-950 text-white px-5 py-2.5 flex items-center gap-3 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-indigo-500 rounded flex items-center justify-center text-[10px] font-bold">JR</div>
          <span className="text-sm font-semibold tracking-tight">Judicial Review</span>
        </div>
        <span className="text-slate-600 text-xs">Citation Verification System</span>
        <div className="flex-1" />
        {error && (
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded max-w-xs truncate hover:bg-red-900/50"
            title={error}
          >
            ✕ {error}
          </button>
        )}
        <button
          onClick={() => setShowHelp(true)}
          className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded px-2.5 py-1.5 transition-colors"
        >
          ? Help
        </button>
        <button
          onClick={() => setShowKeySettings(true)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            hasApiKey
              ? 'border-emerald-600 text-emerald-400 hover:bg-emerald-900/20'
              : 'border-amber-500 text-amber-400 hover:bg-amber-900/20 animate-pulse'
          }`}
        >
          {hasApiKey ? '🔑 API Key' : '⚠ Set API Key'}
        </button>
      </header>

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      {showKeySettings && (
        <ApiKeySettings
          onClose={() => {
            setShowKeySettings(false);
            getApiKey().then((k) => setHasApiKey(!!k));
          }}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Matter sidebar */}
        <MatterSidebar matters={matters} onMatterCreated={handleMatterCreated} />

        {/* No matter selected */}
        {!activeMatter ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <p className="text-4xl mb-3">⚖</p>
              <p className="text-sm font-medium">Select a matter to begin</p>
              <p className="text-xs mt-1 opacity-60">or create a new matter from the sidebar</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Matter header */}
            <div className="bg-white border-b border-slate-200 px-5 py-2 flex items-center gap-3 shrink-0 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{activeMatter.name}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap mt-0.5">
                  {activeMatter.caseNumber && <span>{activeMatter.caseNumber}</span>}
                  {activeMatter.court && <span>· {activeMatter.court}</span>}
                  {activeMatter.isDemo && (
                    <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded text-[10px]">demo</span>
                  )}
                  {(stage === 'extracting' || stage === 'analyzing') && (
                    <span className="text-amber-600 font-medium animate-pulse capitalize">
                      {stage}...
                    </span>
                  )}
                </div>
              </div>

              {/* Document tab bar */}
              <div className="flex gap-1 flex-wrap">
                {[activeMatter.primaryDocument, ...activeMatter.supportingDocuments].map((doc) => {
                  const labels: Record<string, string> = {
                    'motion_for_summary_judgment.txt': 'MSJ',
                    'police_report.txt': 'Police Report',
                    'medical_records_excerpt.txt': 'Medical Records',
                    'witness_statement.txt': 'Witness Statement',
                  };
                  return (
                    <button
                      key={doc}
                      onClick={() => setActiveDocFilename(doc)}
                      className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                        activeDocFilename === doc
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {labels[doc] ?? doc}
                    </button>
                  );
                })}
              </div>

              {/* Re-run button when in review */}
              {isReview && (
                <button
                  onClick={() => { resetPipeline(); }}
                  disabled={running}
                  className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-200 px-2.5 py-1 rounded hover:border-indigo-300 disabled:opacity-50"
                >
                  New run
                </button>
              )}
            </div>

            {/* Bench memo now lives as full tab in review mode — no banner strip needed */}

            {/* Main split */}
            <div className="flex-1 flex overflow-hidden">

              {/* Left: document viewer — hidden in full review mode */}
              {!isReview && (
                <div className="w-[45%] shrink-0 overflow-hidden">
                  <DocumentViewer
                    matter={activeMatter}
                    filename={activeDocFilename}
                    citationStrings={citationHighlights}
                    canExtract={stage === 'idle' || stage === 'approval'}
                    extracting={running && stage === 'extracting'}
                    onExtract={() => runExtract(activeMatter)}
                  />
                </div>
              )}

              {/* Right / full: context-sensitive panel */}
              <div className={`flex flex-col overflow-hidden ${isReview ? 'flex-1' : 'flex-1'}`}>

                {/* IDLE: instructions */}
                {stage === 'idle' && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 p-8 text-center">
                    <p className="text-sm font-medium text-slate-600">
                      Open the Motion for Summary Judgment and click{' '}
                      <span className="text-indigo-600 font-semibold">Extract Citations</span>
                    </p>
                    <p className="text-xs max-w-xs leading-relaxed">
                      The citation extractor runs locally — no API key needed.
                      Cases will be retrieved from CourtListener for your review before any AI validation runs.
                    </p>
                    {report && (
                      <button
                        onClick={() => setStage('review')}
                        className="text-xs text-indigo-500 hover:underline mt-2"
                      >
                        View previous results →
                      </button>
                    )}
                  </div>
                )}

                {/* EXTRACTING spinner */}
                {stage === 'extracting' && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                    <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
                    <p className="text-sm text-slate-600">
                      Extracting citations and querying CourtListener...
                    </p>
                    <p className="text-xs text-slate-400">No API key needed for this step</p>
                  </div>
                )}

                {/* APPROVAL: citation review panel */}
                {stage === 'approval' && (
                  <CitationReviewPanel
                    citations={citations}
                    retrievedCases={retrievedCases}
                    approvedCitations={approvedCitations}
                    mode={mode}
                    onModeChange={handleModeChange}
                    onApproveCitation={approveCitation}
                    onRejectCitation={rejectCitation}
                    onApproveAll={approveAll}
                    onRunAnalysis={() => runAnalysis(activeMatter)}
                    running={running}
                  />
                )}

                {/* ANALYZING spinner */}
                {stage === 'analyzing' && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                    <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
                    <p className="text-sm text-slate-600 font-medium">Running AI validation pipeline...</p>
                    <ol className="text-xs text-slate-400 list-decimal pl-4 space-y-1 text-left">
                      <li>Extracting propositions from MSJ (Sonnet)</li>
                      <li>Validating citations against retrieved case texts (Opus)</li>
                      <li>Cross-referencing SUMF with record documents (Opus)</li>
                      <li>Building argument dependency graph (Opus)</li>
                      <li>Writing bench memo (Opus)</li>
                    </ol>
                  </div>
                )}

                {/* REVIEW: full panel results */}
                {isReview && (
                  <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Result tabs */}
                    <div className="flex border-b border-slate-200 bg-white px-4 shrink-0">
                      <button
                        onClick={() => setActiveResultTab('memo')}
                        className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                          activeResultTab === 'memo'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Bench Memo
                      </button>
                      <button
                        onClick={() => { setActiveResultTab('checklist'); setLeftPanel('msj'); }}
                        className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                          activeResultTab === 'checklist'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Citation Review
                        <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
                          {report.checklist.length}
                        </span>
                      </button>
                      <button
                        onClick={() => setActiveResultTab('dag')}
                        className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                          activeResultTab === 'dag'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Argument Map
                      </button>
                      <div className="flex-1" />
                      {/* Verdict summary pills */}
                      <div className="flex items-center gap-1.5 text-[10px] py-2">
                        {(['fabricated', 'misused', 'suspect', 'verified', 'unverifiable'] as const).map((v) => {
                          const count = report.validation_results.filter((r) => r.verdict === v).length;
                          if (!count) return null;
                          return <VerdictBadge key={v} verdict={v} />;
                        })}
                      </div>
                    </div>

                    {/* Memo: full page with MSJ alongside */}
                    {activeResultTab === 'memo' && (
                      <div className="flex-1 overflow-hidden flex">
                        {/* MSJ on the left for reference */}
                        <div className="w-[40%] shrink-0 border-r border-slate-200 overflow-hidden">
                          <DocumentViewer
                            matter={activeMatter}
                            filename={activeMatter.primaryDocument}
                            citationStrings={citationHighlights}
                            canExtract={false}
                            extracting={false}
                            onExtract={() => {}}
                          />
                        </div>
                        {/* Memo on the right */}
                        <div className="flex-1 overflow-y-auto bg-white">
                          <div className="max-w-2xl mx-auto px-8 py-6">
                            <div className="flex items-center justify-between mb-4">
                              <h2 className="text-base font-semibold text-slate-900">Bench Memo</h2>
                              <button
                                onClick={() => {
                                  const blob = new Blob([report.judicial_memo], { type: 'text/plain' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `bench-memo-${activeMatter.id}.txt`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                                className="text-xs text-indigo-600 hover:underline border border-indigo-200 px-3 py-1 rounded"
                              >
                                Export .txt
                              </button>
                            </div>
                            <div className="text-sm text-slate-700 leading-relaxed space-y-1">
                              {report.judicial_memo.split('\n').map((line, i) => {
                                const trimmed = line.trim();
                                if (!trimmed) return <div key={i} className="h-3" />;
                                if (/^[A-Z][A-Z\s]{2,}:/.test(trimmed)) {
                                  return (
                                    <h3 key={i} className="text-sm font-bold text-slate-900 mt-5 mb-1 border-b border-slate-200 pb-1">
                                      {trimmed}
                                    </h3>
                                  );
                                }
                                return <p key={i}>{trimmed}</p>;
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Citation Review: three-panel — MSJ | case text | checklist */}
                    {activeResultTab === 'checklist' && (
                      <div className="flex-1 overflow-hidden flex">
                        {/* Panel 1: MSJ (40%) */}
                        <div className="w-[40%] shrink-0 border-r border-slate-200 overflow-hidden">
                          <DocumentViewer
                            matter={activeMatter}
                            filename={activeMatter.primaryDocument}
                            citationStrings={citationHighlights}
                            canExtract={false}
                            extracting={false}
                            onExtract={() => {}}
                          />
                        </div>

                        {/* Panel 2: Retrieved case text (40%) */}
                        <div className="w-[40%] shrink-0 border-r border-slate-200 overflow-hidden">
                          {leftPanel === 'msj' ? (
                            <div className="flex flex-col h-full">
                              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
                                <p className="text-xs font-semibold text-slate-600">Retrieved Case Text</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Click "View case text" on any citation to load the retrieved opinion here</p>
                              </div>
                              <div className="flex-1 flex items-center justify-center text-slate-300 text-xs p-4 text-center">
                                Select a citation from the checklist to compare its case text with the MSJ
                              </div>
                            </div>
                          ) : leftPanel.startsWith('case:') ? (
                            (() => {
                              const citId = leftPanel.slice(5);
                              const rc = retrievedCases.find((r) => r.citation_id === citId);
                              return rc ? (
                                <CaseTextPanel retrieved={rc} onBack={() => setLeftPanel('msj')} />
                              ) : (
                                <div className="p-4 text-xs text-slate-400">Case text not available</div>
                              );
                            })()
                          ) : null}
                        </div>

                        {/* Panel 3: Compact citation checklist (20%) */}
                        <div className="flex-1 overflow-hidden flex flex-col">
                          <ResolutionChecklist
                            report={report}
                            checklist={checklist}
                            retrievedCases={retrievedCases}
                            selectedCitationId={selectedCitationId}
                            onSelectCitation={setSelectedCitationId}
                            onViewCaseText={(citId) => setLeftPanel(`case:${citId}`)}
                            onUpdate={updateChecklistItem}
                            onRerun={async (itemId, note) => {
                              const result = await rerunCitation(itemId, note);
                              setReport({
                                ...report,
                                validation_results: report.validation_results.map((v) =>
                                  v.citation_id === itemId ? result.updated_result : v,
                                ),
                              });
                            }}
                            onExport={() => {
                              const audit = {
                                case_name: report.case_name,
                                exported_at: new Date().toISOString(),
                                validation_results: report.validation_results,
                                consistency_flags: report.consistency_flags,
                                judicial_memo: report.judicial_memo,
                                checklist_decisions: checklist,
                              };
                              const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `jr-audit-${activeMatter?.id ?? 'report'}-${Date.now()}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Argument Map: full width */}
                    {activeResultTab === 'dag' && (
                      <div className="flex-1 overflow-hidden grid grid-cols-[1fr_320px]">
                        <ArgumentDAG
                          graph={report.argument_graph}
                          onNodeClick={setSelectedNodeId}
                          selectedId={selectedNodeId}
                        />
                        <div className="border-l border-slate-200 bg-white overflow-y-auto p-4">
                          <DetailPanel
                            report={report}
                            selectedId={selectedNodeId}
                            onRerun={async (citationId, note) => {
                              const result = await rerunCitation(citationId, note);
                              setReport({
                                ...report,
                                validation_results: report.validation_results.map((v) =>
                                  v.citation_id === citationId ? result.updated_result : v,
                                ),
                              });
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
