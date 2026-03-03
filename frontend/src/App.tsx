import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { listMatters, saveAnalysisCache, loadAnalysisCache, readDocument } from './matters';
import { extractCitations, analyzeDocument, rerunCitation } from './api';
import { getApiKey } from './keystore';
import type { AnalyzeRequest, Matter } from './types';
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
  const [activeDocFilename, setActiveDocFilename] = useState<string>('');
  const [activeResultTab, setActiveResultTab] = useState<'checklist' | 'dag'>('checklist');

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
      setActiveResultTab('checklist');
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

            {/* Bench memo banner */}
            {report?.judicial_memo && (
              <div className="bg-indigo-950 text-indigo-100 px-5 py-2 text-xs leading-relaxed shrink-0">
                <span className="text-indigo-400 font-semibold uppercase tracking-wide mr-2 text-[10px]">
                  Bench Memo
                </span>
                {report.judicial_memo}
              </div>
            )}

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
                        onClick={() => setActiveResultTab('checklist')}
                        className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                          activeResultTab === 'checklist'
                            ? 'border-indigo-600 text-indigo-600'
                            : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Resolution Checklist
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
                      {/* Verdict summary */}
                      <div className="flex items-center gap-1.5 text-[10px] py-2">
                        {(['fabricated', 'misused', 'suspect', 'verified', 'unverifiable'] as const).map((v) => {
                          const count = report.validation_results.filter((r) => r.verdict === v).length;
                          if (!count) return null;
                          return <VerdictBadge key={v} verdict={v} />;
                        })}
                      </div>
                    </div>

                    {activeResultTab === 'checklist' && (
                      <div className="flex-1 overflow-y-auto p-4">
                        <ResolutionChecklist
                          report={report}
                          checklist={checklist}
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
                        />
                      </div>
                    )}

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
