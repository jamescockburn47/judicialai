import { useState } from 'react';
import type { ExtractedCitation, RetrievedCase } from '../types';
import { useAppStore } from '../store';

interface Props {
  citations: ExtractedCitation[];
  retrievedCases: RetrievedCase[];
  onRunAnalysis: () => void;
  analyzing: boolean;
}

export function ApprovalStage({ citations, retrievedCases, onRunAnalysis, analyzing }: Props) {
  const { approvedCitations, approveCitation, rejectCitation, approveAll } = useAppStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expandedText, setExpandedText] = useState<string | null>(null);

  const getRetrieved = (id: string) => retrievedCases.find((r) => r.citation_id === id) ?? null;
  const isApproved = (id: string) => approvedCitations.some((a) => a.citation.id === id);

  const handleApprove = (id: string) => {
    const retrieved = getRetrieved(id);
    approveCitation(id, retrieved, notes[id] ?? null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">
          Step 2 — Verify Retrieved Cases ({citations.length} citations found)
        </h2>
        <div className="flex gap-2">
          <button
            onClick={approveAll}
            className="px-3 py-1.5 text-sm bg-slate-700 text-white rounded hover:bg-slate-800"
          >
            Approve All
          </button>
          <button
            onClick={onRunAnalysis}
            disabled={analyzing || approvedCitations.length === 0}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {analyzing ? 'Running analysis...' : `Run Analysis (${approvedCitations.length} approved)`}
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        Review each citation and the case retrieved from public databases. Approve, reject, or add a
        note before running AI validation.
      </p>

      <div className="flex flex-col gap-3">
        {citations.map((c) => {
          const retrieved = getRetrieved(c.id);
          const approved = isApproved(c.id);
          const isUnresolvable = !retrieved || retrieved.status === 'unresolvable' || retrieved.url === '';

          return (
            <div
              key={c.id}
              className={`border rounded-lg p-4 ${
                approved ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-medium text-slate-800 break-words">
                    {c.citation_string}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                    {c.reporter && <span className="bg-slate-100 px-1.5 py-0.5 rounded">{c.reporter}</span>}
                    {c.court && <span className="bg-slate-100 px-1.5 py-0.5 rounded">{c.court}</span>}
                    {c.year && <span className="bg-slate-100 px-1.5 py-0.5 rounded">{c.year}</span>}
                  </div>

                  {retrieved && !isUnresolvable && (
                    <div className="mt-2 text-sm text-slate-700">
                      <span className="font-medium">Retrieved: </span>
                      <a
                        href={retrieved.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:underline"
                      >
                        {retrieved.title ?? 'View case'}
                      </a>
                      {retrieved.court_name && (
                        <span className="text-slate-500 ml-2">— {retrieved.court_name}</span>
                      )}
                      {retrieved.decision_date && (
                        <span className="text-slate-500 ml-2">({retrieved.decision_date})</span>
                      )}
                      <span className={`ml-2 text-xs font-medium ${
                        retrieved.confidence >= 0.85 ? 'text-emerald-600'
                          : retrieved.confidence >= 0.65 ? 'text-amber-600'
                          : 'text-red-500'
                      }`}>
                        {Math.round(retrieved.confidence * 100)}% confidence
                      </span>
                    </div>
                  )}

                  {isUnresolvable && (
                    <p className="mt-2 text-sm text-amber-700 bg-amber-50 rounded px-2 py-1">
                      Case not found in public databases — will be assessed for plausibility only
                    </p>
                  )}

                  {retrieved?.full_text && (
                    <button
                      onClick={() => setExpandedText(expandedText === c.id ? null : c.id)}
                      className="mt-1 text-xs text-indigo-500 hover:underline"
                    >
                      {expandedText === c.id ? 'Hide case text' : 'Show case text'}
                    </button>
                  )}
                  {expandedText === c.id && retrieved?.full_text && (
                    <pre className="mt-2 max-h-48 overflow-y-auto text-xs text-slate-600 bg-slate-50 rounded p-2 whitespace-pre-wrap">
                      {retrieved.full_text.slice(0, 3000)}
                      {retrieved.full_text.length > 3000 && '\n[truncated...]'}
                    </pre>
                  )}

                  <input
                    type="text"
                    placeholder="Optional note (e.g. wrong case retrieved)"
                    value={notes[c.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })}
                    className="mt-2 w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  {approved ? (
                    <button
                      onClick={() => rejectCitation(c.id)}
                      className="px-3 py-1 text-xs bg-slate-200 text-slate-700 rounded hover:bg-slate-300"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => handleApprove(c.id)}
                      className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
