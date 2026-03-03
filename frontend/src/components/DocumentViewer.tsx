import { useState, useEffect } from 'react';
import type { Matter } from '../types';
import { readDocument } from '../matters';

interface Props {
  matter: Matter;
  filename: string;
  onClose: () => void;
}

const DOC_LABELS: Record<string, string> = {
  'motion_for_summary_judgment.txt': 'Motion for Summary Judgment',
  'police_report.txt': 'Police Report',
  'medical_records_excerpt.txt': 'Medical Records',
  'witness_statement.txt': 'Witness Statement',
};

export function DocumentViewer({ matter, filename, onClose }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    readDocument(matter, filename)
      .then(setText)
      .finally(() => setLoading(false));
  }, [matter, filename]);

  const label = DOC_LABELS[filename] ?? filename;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Document</p>
          <p className="text-sm font-semibold text-slate-800">{label}</p>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 text-xl leading-none"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-slate-400 animate-pulse">Loading...</p>
        ) : (
          <pre className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap font-mono">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
