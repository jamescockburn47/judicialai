import { useState } from 'react';
import type { AnalysisReport, ChecklistItem, RetrievedCase, ValidationResult } from '../types';
import { VerdictBadge } from './VerdictBadge';

interface Props {
  report: AnalysisReport;
  checklist: ChecklistItem[];
  retrievedCases: RetrievedCase[];
  selectedCitationId: string | null;
  onSelectCitation: (id: string | null) => void;
  onViewCaseText: (citationId: string) => void;
  onUpdate: (id: string, update: Partial<ChecklistItem>) => void;
  onRerun: (itemId: string, note: string) => Promise<void>;
  onExport: () => void;
}

// ── Compact citation row (single line) ────────────────────────────────────────

function CitationRow({
  item,
  validationResult,
  retrieved,
  isSelected,
  onSelect,
  onViewCaseText,
  onAccept,
  onFlag,
}: {
  item: ChecklistItem;
  validationResult: ValidationResult | undefined;
  retrieved: RetrievedCase | undefined;
  isSelected: boolean;
  onSelect: () => void;
  onViewCaseText: () => void;
  onAccept: () => void;
  onFlag: () => void;
}) {
  const hasText = !!retrieved?.full_text && retrieved.full_text.length > 200;
  const isFabricated = retrieved?.cite_count === 0;

  const statusBg =
    item.status === 'accepted' ? 'bg-emerald-50 border-emerald-200' :
    item.status === 'flagged'  ? 'bg-red-50 border-red-200' :
    isSelected                 ? 'bg-indigo-50 border-indigo-300' :
                                 'bg-white border-slate-200 hover:border-slate-300';

  return (
    <div
      className={`border rounded flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[10px] ${statusBg}`}
      onClick={onSelect}
    >
      {/* Verdict badge */}
      {item.verdict && <VerdictBadge verdict={item.verdict} />}

      {/* Citation label — truncated */}
      <span className="flex-1 min-w-0 truncate text-slate-800 font-mono" title={item.label}>
        {item.label}
      </span>

      {/* Signals */}
      {isFabricated && <span className="text-red-600 font-bold shrink-0" title="0 citations in graph — fabrication signal">⚠</span>}
      {item.rerun_count > 0 && <span className="text-indigo-500 shrink-0">↻{item.rerun_count}</span>}

      {/* View case text */}
      <button
        onClick={(e) => { e.stopPropagation(); onViewCaseText(); }}
        className={`shrink-0 rounded px-1 py-0.5 ${hasText ? 'text-indigo-500 hover:bg-indigo-100' : 'text-slate-300'}`}
        title={hasText ? 'View case text' : 'No case text available'}
        disabled={!hasText}
      >
        ⬚
      </button>

      {/* Accept / Flag icon buttons */}
      {item.status !== 'accepted' ? (
        <button
          onClick={(e) => { e.stopPropagation(); onAccept(); }}
          className="shrink-0 text-emerald-600 hover:bg-emerald-100 rounded px-1 py-0.5"
          title="Accept"
        >✓</button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onAccept(); }}
          className="shrink-0 text-slate-400 hover:bg-slate-100 rounded px-1 py-0.5 text-[9px]"
          title="Undo accept"
        >✓</button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onFlag(); }}
        className={`shrink-0 rounded px-1 py-0.5 ${item.status === 'flagged' ? 'text-red-600 bg-red-100' : 'text-amber-500 hover:bg-amber-100'}`}
        title="Flag"
      >⚑</button>
    </div>
  );
}

// ── Selected citation detail pane ─────────────────────────────────────────────

function CitationDetail({
  item,
  result,
  note,
  rerunning,
  onNoteChange,
  onRerun,
  onClose,
}: {
  item: ChecklistItem;
  result: ValidationResult | undefined;
  note: string;
  rerunning: boolean;
  onNoteChange: (v: string) => void;
  onRerun: () => void;
  onClose: () => void;
}) {
  if (!result) return null;

  return (
    <div className="border border-indigo-200 rounded bg-indigo-50 p-2.5 text-[10px] space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <p className="font-mono text-slate-700 text-[9px] truncate flex-1">{item.label}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 shrink-0 ml-1">×</button>
      </div>

      <div>
        <span className="text-slate-400 font-medium">Proposition: </span>
        <span className="text-slate-700">{result.proposition}</span>
      </div>

      <div>
        <span className="text-slate-400 font-medium">Analysis: </span>
        <span className="text-slate-700">{result.reasoning}</span>
      </div>

      {result.quote_analysis && (
        <div className={result.quote_accurate === false ? 'text-red-700' : 'text-slate-700'}>
          <span className="font-medium">{result.quote_accurate === false ? '⚠ Quote inaccurate: ' : 'Quote: '}</span>
          {result.quote_analysis}
        </div>
      )}

      {result.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {result.flags.map((f, i) => (
            <span key={i} className="bg-amber-100 text-amber-700 rounded px-1 py-0.5">{f}</span>
          ))}
        </div>
      )}

      {/* Rerun */}
      {item.status !== 'accepted' && (
        <div className="flex gap-1 pt-1 border-t border-indigo-200">
          <input
            type="text"
            placeholder="Note for rerun (e.g. check Hooker exception)..."
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            className="flex-1 text-[10px] border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
          />
          <button
            onClick={onRerun}
            disabled={rerunning || !note.trim()}
            className="shrink-0 px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {rerunning ? '...' : 'Rerun'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ResolutionChecklist({
  report, checklist, retrievedCases, selectedCitationId,
  onSelectCitation, onViewCaseText, onUpdate, onRerun, onExport,
}: Props) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [flagging, setFlagging] = useState<string | null>(null);

  const handleAccept = (item: ChecklistItem) => {
    if (item.status === 'accepted') {
      onUpdate(item.id, { status: 'pending' });
    } else {
      onUpdate(item.id, { status: 'accepted' });
      if (selectedCitationId === item.id) onSelectCitation(null);
    }
  };

  const handleFlag = (item: ChecklistItem) => {
    if (flagging === item.id) {
      onUpdate(item.id, { status: 'flagged', judge_note: notes[item.id] ?? null });
      setFlagging(null);
    } else {
      setFlagging(item.id);
      onSelectCitation(item.id);
    }
  };

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

  const citationItems = checklist.filter((i) => i.item_type === 'citation');
  const consistencyItems = checklist.filter((i) => i.item_type === 'consistency_flag');
  const accepted = checklist.filter((i) => i.status === 'accepted').length;
  const flagged = checklist.filter((i) => i.status === 'flagged').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200 shrink-0 bg-white">
        <span className="text-[10px] text-slate-400">
          {accepted}✓ · {flagged}⚑ · {checklist.length - accepted - flagged} pending
        </span>
        <button
          onClick={onExport}
          className="text-[10px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-0.5 hover:border-slate-400"
        >
          Export
        </button>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">

        {/* Citations */}
        {citationItems.length > 0 && (
          <p className="text-[9px] text-slate-400 uppercase tracking-widest font-medium pt-1 pb-0.5">
            Citations
          </p>
        )}
        {citationItems.map((item) => {
          const vr = report.validation_results.find(
            (v) => v.citation_id === item.id || v.citation_string === item.label,
          );
          const rc = retrievedCases.find((r) => r.citation_id === item.id);
          const isSelected = selectedCitationId === item.id;

          return (
            <div key={item.id}>
              <CitationRow
                item={item}
                validationResult={vr}
                retrieved={rc}
                isSelected={isSelected}
                onSelect={() => onSelectCitation(isSelected ? null : item.id)}
                onViewCaseText={() => onViewCaseText(item.id)}
                onAccept={() => handleAccept(item)}
                onFlag={() => handleFlag(item)}
              />
              {isSelected && vr && (
                <CitationDetail
                  item={item}
                  result={vr}
                  note={notes[item.id] ?? ''}
                  rerunning={rerunning[item.id] ?? false}
                  onNoteChange={(v) => setNotes({ ...notes, [item.id]: v })}
                  onRerun={() => handleRerun(item)}
                  onClose={() => onSelectCitation(null)}
                />
              )}
            </div>
          );
        })}

        {/* Consistency flags */}
        {consistencyItems.length > 0 && (
          <>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-medium pt-2 pb-0.5">
              Factual Contradictions
            </p>
            {consistencyItems.map((item) => {
              const flag = report.consistency_flags.find((f) => f.id === item.id);
              const isSelected = selectedCitationId === item.id;

              return (
                <div key={item.id}>
                  <div
                    className={`border rounded flex items-center gap-1.5 px-2 py-1.5 cursor-pointer text-[10px] ${
                      item.status === 'accepted' ? 'bg-emerald-50 border-emerald-200' :
                      item.status === 'flagged'  ? 'bg-red-50 border-red-200' :
                      isSelected                 ? 'bg-indigo-50 border-indigo-300' :
                                                   'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                    onClick={() => onSelectCitation(isSelected ? null : item.id)}
                  >
                    <span className={`shrink-0 text-[9px] font-bold rounded px-1 py-0.5 ${
                      flag?.status === 'contradicted' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {flag?.status === 'contradicted' ? 'CONTRA' : 'PARTIAL'}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-slate-700" title={item.label}>{item.label}</span>
                    {item.status !== 'accepted' && (
                      <button onClick={(e) => { e.stopPropagation(); handleAccept(item); }}
                        className="shrink-0 text-emerald-600 hover:bg-emerald-100 rounded px-1 py-0.5">✓</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleFlag(item); }}
                      className={`shrink-0 rounded px-1 py-0.5 ${item.status === 'flagged' ? 'text-red-600 bg-red-100' : 'text-amber-500 hover:bg-amber-100'}`}>⚑</button>
                  </div>
                  {isSelected && flag?.detail && (
                    <div className="border border-indigo-200 rounded bg-indigo-50 px-2.5 py-1.5 text-[10px] text-slate-700 space-y-1">
                      <p className="font-medium text-slate-900">{item.label}</p>
                      <p className="leading-relaxed">{flag.detail}</p>
                      <button onClick={() => onSelectCitation(null)} className="text-slate-400 hover:text-slate-600">Close ×</button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
