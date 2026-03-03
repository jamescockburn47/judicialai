import type { Matter } from '../types';
import { useAppStore } from '../store';
import { ModeToggle } from './ModeToggle';

interface Props {
  matter: Matter;
  onRunAnalysis: () => void;
  running: boolean;
}

const DOC_LABELS: Record<string, string> = {
  'motion_for_summary_judgment.txt': 'Motion for Summary Judgment',
  'police_report.txt': 'Police Report',
  'medical_records_excerpt.txt': 'Medical Records',
  'witness_statement.txt': 'Witness Statement',
};

export function MatterHeader({ matter, onRunAnalysis, running }: Props) {
  const { mode, setMode, stage, resetPipeline, setActiveDocumentView, setActiveTab } = useAppStore();

  const allDocs = [matter.primaryDocument, ...matter.supportingDocuments];

  const handleModeChange = (m: typeof mode) => {
    if (stage !== 'idle' && stage !== 'review') {
      if (!confirm('Switching mode will reset the current analysis run. Continue?')) return;
      resetPipeline();
    }
    setMode(m);
  };

  const handleViewDoc = (doc: string) => {
    setActiveDocumentView(doc);
    setActiveTab('documents');
  };

  return (
    <div className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{matter.name}</h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            {matter.caseNumber && <span>{matter.caseNumber}</span>}
            {matter.court && <span>· {matter.court}</span>}
            {matter.isDemo && (
              <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">Demo matter</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <ModeToggle
            mode={mode}
            onChange={handleModeChange}
            disabled={running}
          />
          <button
            onClick={onRunAnalysis}
            disabled={running || stage === 'approval'}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
          >
            {running ? 'Running...' : stage === 'review' ? 'Re-run Analysis' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {/* Document list */}
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="text-xs text-slate-400 self-center">Documents:</span>
        {allDocs.map((doc) => (
          <button
            key={doc}
            onClick={() => handleViewDoc(doc)}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded px-2 py-1 transition-colors"
          >
            {DOC_LABELS[doc] ?? doc}
          </button>
        ))}
      </div>
    </div>
  );
}
