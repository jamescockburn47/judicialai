import { useState } from 'react';
import type { AnalysisReport, ChecklistItem, ValidationResult } from '../types';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  report: AnalysisReport;
  checklist: ChecklistItem[];
  onUpdate: (id: string, update: Partial<ChecklistItem>) => void;
  onRerun: (itemId: string, note: string) => Promise<void>;
}

function CitationDetail({ result }: { result: ValidationResult }) {
  const [showText, setShowText] = useState(false);

  return (
    <div className="mt-2 text-xs text-slate-600 space-y-1.5 border-t border-slate-100 pt-2">
      <div>
        <span className="text-slate-400 uppercase tracking-wide text-[10px] font-medium">Proposition in brief: </span>
        <span>{result.proposition}</span>
      </div>
      <div>
        <span className="text-slate-400 uppercase tracking-wide text-[10px] font-medium">Analysis: </span>
        <span>{result.reasoning}</span>
      </div>
      {result.quote_analysis && (
        <div>
          <span className={`text-[10px] font-medium uppercase tracking-wide ${result.quote_accurate === false ? 'text-red-600' : 'text-slate-400'}`}>
            Quote: {result.quote_accurate === false ? 'INACCURATE — ' : ''}
          </span>
          <span className={result.quote_accurate === false ? 'text-red-700' : ''}>{result.quote_analysis}</span>
        </div>
      )}
      {result.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.flags.map((f, i) => (
            <span key={i} className="bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 text-[10px]">
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResolutionChecklist({ report, checklist, onUpdate, onRerun }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const handleAccept = (item: ChecklistItem) => onUpdate(item.id, { status: 'accepted' });
  const handleFlag = (item: ChecklistItem) =>
    onUpdate(item.id, { status: 'flagged', judge_note: notes[item.id] ?? null });

  const handleRerun = async (item: ChecklistItem) => {
    const note = notes[item.id];
    if (!note?.trim()) return;
    setRerunning((r) => ({ ...r, [item.id]: true }));
    onUpdate(item.id, { status: 'rerunning', rerun_count: item.rerun_count + 1 });
    try {
      await onRerun(item.id, note);
      onUpdate(item.id, { status: 'pending', judge_note: note });
    } catch {
      onUpdate(item.id, { status: 'flagged' });
    } finally {
      setRerunning((r) => ({ ...r, [item.id]: false }));
    }
  };

  const handleExport = () => {
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
    a.download = `jr-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accepted = checklist.filter((i) => i.status === 'accepted').length;
  const flagged = checklist.filter((i) => i.status === 'flagged').length;

  // Group: citations first, then consistency flags
  const citationItems = checklist.filter((i) => i.item_type === 'citation');
  const consistencyItems = checklist.filter((i) => i.item_type === 'consistency_flag');

  return (
    <div className="flex flex-col gap-3">
      {/* Summary + export */}
      <div className="flex items-center justify-between sticky top-0 bg-slate-50 py-1 z-10">
        <div className="text-xs text-slate-500">
          {accepted} accepted · {flagged} flagged · {checklist.length - accepted - flagged} pending
        </div>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
        >
          Export Audit Trail
        </button>
      </div>

      {/* Citation verdicts */}
      <div>
        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-2">
          Citations ({citationItems.length})
        </p>
        <div className="flex flex-col gap-2">
          {citationItems.map((item) => {
            const validationResult = report.validation_results.find(
              (v) => v.citation_id === item.id || v.citation_string === item.label,
            );
            const isExpanded = expanded[item.id];

            return (
              <div
                key={item.id}
                className={`border rounded-lg ${
                  item.status === 'accepted' ? 'border-emerald-200 bg-emerald-50'
                    : item.status === 'flagged' ? 'border-red-200 bg-red-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                {/* Header row */}
                <div className="flex items-start gap-2 p-3">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))}
                    className="mt-0.5 text-slate-400 hover:text-slate-700 shrink-0 text-xs"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.verdict && <VerdictBadge verdict={item.verdict} />}
                      {item.confidence && (
                        <span className="text-[10px] text-slate-500">{item.confidence} conf.</span>
                      )}
                      {item.rerun_count > 0 && (
                        <span className="text-[10px] text-indigo-600">↻ {item.rerun_count}×</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-800 font-mono break-words">{item.label}</p>
                    {item.judge_note && (
                      <p className="mt-0.5 text-[10px] text-slate-500 italic">Note: {item.judge_note}</p>
                    )}

                    {/* Inline detail when expanded */}
                    {isExpanded && validationResult && (
                      <CitationDetail result={validationResult} />
                    )}

                    {/* Note input */}
                    {item.status !== 'accepted' && (
                      <input
                        type="text"
                        placeholder="Note for flagging or rerun..."
                        value={notes[item.id] ?? ''}
                        onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                        className="mt-2 w-full text-[10px] border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {item.status !== 'accepted' && (
                      <button
                        onClick={() => handleAccept(item)}
                        className="px-2.5 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        Accept
                      </button>
                    )}
                    {item.status !== 'flagged' && (
                      <button
                        onClick={() => handleFlag(item)}
                        className="px-2.5 py-1 text-[10px] bg-amber-500 text-white rounded hover:bg-amber-600"
                      >
                        Flag
                      </button>
                    )}
                    {item.item_type === 'citation' && (
                      <button
                        onClick={() => handleRerun(item)}
                        disabled={rerunning[item.id] || !notes[item.id]?.trim()}
                        className="px-2.5 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {rerunning[item.id] ? '...' : 'Rerun'}
                      </button>
                    )}
                    {item.status === 'accepted' && (
                      <button
                        onClick={() => onUpdate(item.id, { status: 'pending' })}
                        className="px-2.5 py-1 text-[10px] bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Consistency flags */}
      {consistencyItems.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-2">
            Factual Record Issues ({consistencyItems.length})
          </p>
          <div className="flex flex-col gap-2">
            {consistencyItems.map((item) => {
              const flag = report.consistency_flags.find((f) => f.id === item.id);

              return (
                <div
                  key={item.id}
                  className={`border rounded-lg p-3 ${
                    item.status === 'accepted' ? 'border-emerald-200 bg-emerald-50'
                      : item.status === 'flagged' ? 'border-red-200 bg-red-50'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${
                          flag?.status === 'contradicted' ? 'bg-red-100 text-red-700'
                            : flag?.status === 'unsupported' ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {flag?.status ?? 'unknown'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-800 break-words">{item.label}</p>
                      {flag?.detail && (
                        <p className="mt-1 text-[10px] text-slate-600 leading-relaxed">{flag.detail}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {item.status !== 'accepted' && (
                        <button onClick={() => handleAccept(item)} className="px-2.5 py-1 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700">Accept</button>
                      )}
                      {item.status !== 'flagged' && (
                        <button onClick={() => handleFlag(item)} className="px-2.5 py-1 text-[10px] bg-amber-500 text-white rounded hover:bg-amber-600">Flag</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
