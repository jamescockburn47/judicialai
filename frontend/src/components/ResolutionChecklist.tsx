import { useState } from 'react';
import type { AnalysisReport, ChecklistItem } from '../types';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  report: AnalysisReport;
  checklist: ChecklistItem[];
  onUpdate: (id: string, update: Partial<ChecklistItem>) => void;
  onRerun: (itemId: string, note: string) => Promise<void>;
}

export function ResolutionChecklist({ report, checklist, onUpdate, onRerun }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {accepted} accepted · {flagged} flagged · {checklist.length - accepted - flagged} pending
        </div>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 text-xs bg-slate-700 text-white rounded hover:bg-slate-800"
        >
          Export Audit Trail
        </button>
      </div>

      {checklist.map((item) => (
        <div
          key={item.id}
          className={`border rounded-lg p-3 ${
            item.status === 'accepted' ? 'border-emerald-200 bg-emerald-50'
              : item.status === 'flagged' ? 'border-red-200 bg-red-50'
              : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 uppercase tracking-wide">
                  {item.item_type === 'citation' ? 'Citation' : 'SUMF'}
                </span>
                {item.verdict && <VerdictBadge verdict={item.verdict} />}
                {item.confidence && (
                  <span className="text-xs text-slate-500">{item.confidence} conf.</span>
                )}
                {item.rerun_count > 0 && (
                  <span className="text-xs text-indigo-600">↻ {item.rerun_count}×</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-800 break-words">{item.label}</p>
              {item.judge_note && (
                <p className="mt-0.5 text-xs text-slate-500 italic">Note: {item.judge_note}</p>
              )}
              {item.status !== 'accepted' && (
                <input
                  type="text"
                  placeholder="Note for flagging or rerun..."
                  value={notes[item.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                  className="mt-2 w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              )}
            </div>

            <div className="flex flex-col gap-1 shrink-0">
              {item.status !== 'accepted' && (
                <button
                  onClick={() => handleAccept(item)}
                  className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700"
                >
                  Accept
                </button>
              )}
              {item.status !== 'flagged' && (
                <button
                  onClick={() => handleFlag(item)}
                  className="px-2.5 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600"
                >
                  Flag
                </button>
              )}
              {item.item_type === 'citation' && (
                <button
                  onClick={() => handleRerun(item)}
                  disabled={rerunning[item.id] || !notes[item.id]?.trim()}
                  className="px-2.5 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  {rerunning[item.id] ? '...' : 'Rerun'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
