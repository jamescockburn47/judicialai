import { useState } from 'react';
import type { AnalysisReport, ValidationResult } from '../types';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  report: AnalysisReport;
  selectedId: string | null;
  onRerun: (citationId: string, note: string) => Promise<void>;
}

export function DetailPanel({ report, selectedId, onRerun }: Props) {
  const [judgeNote, setJudgeNote] = useState('');
  const [rerunning, setRerunning] = useState(false);

  const validation = report.validation_results.find((v) => v.citation_id === selectedId);
  const consistency = report.consistency_flags.find((f) => f.id === selectedId);

  if (!selectedId) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Click a node in the graph to view details
      </div>
    );
  }

  if (!validation && !consistency) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        No details available for selected node
      </div>
    );
  }

  const handleRerun = async () => {
    if (!validation || !judgeNote.trim()) return;
    setRerunning(true);
    try {
      await onRerun(validation.citation_id, judgeNote);
      setJudgeNote('');
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {validation && (
        <>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Citation</p>
            <p className="font-mono text-sm text-slate-800 break-words">{validation.citation_string}</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <VerdictBadge verdict={validation.verdict} />
            <span className={`text-xs font-medium ${
              validation.confidence === 'high' ? 'text-slate-800'
                : validation.confidence === 'medium' ? 'text-amber-700'
                : 'text-slate-500'
            }`}>
              {validation.confidence} confidence
            </span>
            {validation.is_structural && (
              <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">
                Structural
              </span>
            )}
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Proposition</p>
            <p className="text-sm text-slate-700 leading-relaxed">{validation.proposition}</p>
          </div>

          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Reasoning</p>
            <p className="text-sm text-slate-700 leading-relaxed">{validation.reasoning}</p>
          </div>

          {validation.quote_analysis && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">
                Quote Analysis
                {validation.quote_accurate === false && (
                  <span className="text-red-600 normal-case font-semibold ml-1">— INACCURATE</span>
                )}
              </p>
              <p className="text-sm text-slate-700 leading-relaxed">{validation.quote_analysis}</p>
            </div>
          )}

          {validation.flags.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Flags</p>
              <ul className="list-disc pl-4 text-sm text-slate-700 space-y-1">
                {validation.flags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-2">
              Judicial Note — Rerun
            </p>
            <textarea
              value={judgeNote}
              onChange={(e) => setJudgeNote(e.target.value)}
              rows={3}
              placeholder="Enter a specific concern to be addressed in reanalysis..."
              className="w-full text-sm border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
            />
            <button
              onClick={handleRerun}
              disabled={rerunning || !judgeNote.trim()}
              className="mt-2 w-full py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {rerunning ? 'Rerunning...' : 'Rerun with Note'}
            </button>
          </div>
        </>
      )}

      {consistency && !validation && (
        <>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">SUMF Assertion</p>
            <p className="text-sm text-slate-700 leading-relaxed">{consistency.sumf_assertion}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Status</p>
            <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${
              consistency.status === 'contradicted' ? 'bg-red-100 text-red-800 border-red-200'
                : consistency.status === 'supported' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : 'bg-amber-100 text-amber-800 border-amber-200'
            }`}>
              {consistency.status}
            </span>
          </div>
          {consistency.contradicted_by.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Contradicted by</p>
              <ul className="list-disc pl-4 text-sm text-slate-700">
                {consistency.contradicted_by.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Detail</p>
            <p className="text-sm text-slate-700 leading-relaxed">{consistency.detail}</p>
          </div>
        </>
      )}
    </div>
  );
}
