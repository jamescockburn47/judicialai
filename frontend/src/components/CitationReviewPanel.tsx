/**
 * CitationReviewPanel — shown after extraction, before analysis.
 *
 * Shows the list of extracted citations with their retrieved case data.
 * Clicking "View Case" replaces the panel with the full case text.
 * Back button returns to the list.
 *
 * The Auto/Manual mode toggle and "Run Analysis" button live here.
 */
import { useState } from 'react';
import type { AnalysisMode, ApprovedCitation, ExtractedCitation, RetrievedCase } from '../types';
import { ModeToggle } from './ModeToggle';

const SOURCE_LABELS: Record<string, string> = {
  courtlistener: 'CourtListener',
  cap: 'Caselaw Access Project',
  eval_hint: 'Provided',
};

interface Props {
  citations: ExtractedCitation[];
  retrievedCases: RetrievedCase[];
  approvedCitations: ApprovedCitation[];
  mode: AnalysisMode;
  onModeChange: (m: AnalysisMode) => void;
  onApproveCitation: (id: string, retrieved: RetrievedCase | null, note: string | null) => void;
  onRejectCitation: (id: string) => void;
  onApproveAll: () => void;
  onRunAnalysis: () => void;
  running: boolean;
}

function CaseTextView({
  citation,
  retrieved,
  onBack,
}: {
  citation: ExtractedCitation;
  retrieved: RetrievedCase | null;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-xs"
        >
          ← Back
        </button>
        <span className="text-slate-300">|</span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-800 truncate">{citation.citation_string}</p>
          {retrieved?.title && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{retrieved.title}</p>
          )}
        </div>
      </div>

      {/* Retrieved metadata */}
      {retrieved && retrieved.status === 'resolved' && (
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0 flex flex-wrap gap-3 text-xs text-slate-600">
          {retrieved.source && (
            <span>
              <span className="text-slate-400">Source: </span>
              {SOURCE_LABELS[retrieved.source] ?? retrieved.source}
            </span>
          )}
          {retrieved.court_name && (
            <span>
              <span className="text-slate-400">Court: </span>
              {retrieved.court_name}
            </span>
          )}
          {retrieved.decision_date && (
            <span>
              <span className="text-slate-400">Date: </span>
              {retrieved.decision_date}
            </span>
          )}
          {retrieved.cite_count !== null && retrieved.cite_count !== undefined && (
            <span className={`font-medium ${
              retrieved.cite_count === 0 ? 'text-red-600' : 'text-slate-600'
            }`}>
              <span className="text-slate-400">Citations in graph: </span>
              {retrieved.cite_count === 0 ? '0 ⚠ fabrication signal' : retrieved.cite_count}
            </span>
          )}
          {retrieved.url && (
            <a
              href={retrieved.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-500 hover:underline"
            >
              Open source ↗
            </a>
          )}
          <span
            className={`font-medium ${
              retrieved.confidence >= 0.85
                ? 'text-emerald-600'
                : retrieved.confidence >= 0.6
                ? 'text-amber-600'
                : 'text-red-500'
            }`}
          >
            {Math.round(retrieved.confidence * 100)}% match
          </span>
        </div>
      )}

      {/* Case text */}
      <div className="flex-1 overflow-y-auto p-4">
        {!retrieved || retrieved.status === 'unresolvable' || retrieved.status === 'not_found' || retrieved.status === 'not_indexed' ? (
          <div className="flex flex-col gap-2 text-slate-500 text-sm">
            <p className="font-medium text-amber-700">Case not found in public databases</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              This citation could not be located in CourtListener or the Caselaw Access Project.
              During validation, it will be assessed for plausibility only — a fabricated or
              non-existent case is a primary indicator of citation hallucination.
            </p>
          </div>
        ) : retrieved.full_text ? (
          <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
            {retrieved.full_text}
          </pre>
        ) : (
          <div className="text-sm text-slate-500">
            <p>Case located but full text not available.</p>
            {retrieved.url && (
              <a
                href={retrieved.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 hover:underline text-xs mt-2 inline-block"
              >
                Open in browser ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CitationReviewPanel({
  citations,
  retrievedCases,
  approvedCitations,
  mode,
  onModeChange,
  onApproveCitation,
  onRejectCitation,
  onApproveAll,
  onRunAnalysis,
  running,
}: Props) {
  const [viewingCase, setViewingCase] = useState<string | null>(null); // citation id
  const [notes, setNotes] = useState<Record<string, string>>({});

  const getRetrieved = (id: string) => retrievedCases.find((r) => r.citation_id === id) ?? null;
  const isApproved = (id: string) => approvedCitations.some((a) => a.citation.id === id);
  const approvedCount = approvedCitations.length;

  if (viewingCase) {
    const citation = citations.find((c) => c.id === viewingCase);
    const retrieved = getRetrieved(viewingCase);
    if (!citation) return null;
    // Wrap in flex-1 min-h-0 so CaseTextView fills the parent flex column
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <CaseTextView
          citation={citation}
          retrieved={retrieved}
          onBack={() => setViewingCase(null)}
        />
      </div>
    );
  }

  const resolved = retrievedCases.filter((r) => r.status === 'resolved').length;
  const unresolvable = retrievedCases.filter((r) => r.status === 'unresolvable' || r.status === 'not_found' || r.status === 'not_indexed').length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header: mode + run button */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {citations.length} citations extracted
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {resolved} retrieved · {unresolvable} not found/not indexed
              {mode === 'manual' && approvedCount > 0 && ` · ${approvedCount} approved`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'manual' && (
              <button
                onClick={onApproveAll}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
              >
                Approve all
              </button>
            )}
            <button
              onClick={onRunAnalysis}
              disabled={running || (mode === 'manual' && approvedCount === 0)}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? 'Running...' : 'Run Analysis'}
            </button>
          </div>
        </div>
        <div className="mt-2">
          <ModeToggle mode={mode} onChange={onModeChange} disabled={running} />
        </div>
      </div>

      {/* Citation list */}
      <div className="flex-1 overflow-y-auto">
        {citations.map((c) => {
          const retrieved = getRetrieved(c.id);
          const approved = isApproved(c.id);
          const unresolvable = !retrieved || retrieved.status === 'unresolvable' || retrieved.status === 'not_found' || retrieved.status === 'not_indexed';

          return (
            <div
              key={c.id}
              className={`border-b border-slate-100 px-4 py-3 ${
                approved ? 'bg-emerald-50' : 'bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Citation string */}
                  <p className="text-xs font-mono text-slate-800 leading-snug break-words">
                    {c.citation_string}
                  </p>

                  {/* Retrieved info */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span
                      className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${
                        unresolvable
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {unresolvable
                        ? (retrieved?.status === 'not_indexed' ? 'Not indexed (not a fabrication signal)' : 'Not found in databases')
                        : `${Math.round((retrieved?.confidence ?? 0) * 100)}% match`}
                    </span>
                    {/* Cite count — key fabrication signal */}
                    {retrieved?.cite_count !== null && retrieved?.cite_count !== undefined && (
                      <span
                        className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${
                          retrieved.cite_count === 0
                            ? 'bg-red-100 text-red-700'
                            : retrieved.cite_count < 10
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title="Number of times this case is cited in CourtListener's citation graph. 0 = strong fabrication signal."
                      >
                        {retrieved.cite_count === 0
                          ? '⚠ 0 citations (fabrication signal)'
                          : `${retrieved.cite_count} citations`}
                      </span>
                    )}
                    {retrieved?.title && !unresolvable && (
                      <span className="text-[10px] text-slate-500 truncate max-w-[180px]">
                        {retrieved.title}
                      </span>
                    )}
                    {!unresolvable && (
                      <button
                        onClick={() => setViewingCase(c.id)}
                        className="text-[10px] text-indigo-500 hover:underline"
                      >
                        View case →
                      </button>
                    )}
                  </div>

                  {/* Manual mode: note input */}
                  {mode === 'manual' && !approved && (
                    <input
                      type="text"
                      placeholder="Note (optional)"
                      value={notes[c.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                      className="mt-1.5 w-full text-[10px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  )}
                </div>

                {/* Manual mode: approve/undo button */}
                {mode === 'manual' && (
                  <button
                    onClick={() =>
                      approved
                        ? onRejectCitation(c.id)
                        : onApproveCitation(c.id, retrieved, notes[c.id] ?? null)
                    }
                    className={`shrink-0 text-[10px] rounded px-2 py-1 font-medium ${
                      approved
                        ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {approved ? 'Undo' : 'Approve'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
