import type { AnalysisMode } from '../types';

interface Props {
  mode: AnalysisMode;
  onChange: (m: AnalysisMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Mode</span>
      <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
        <button
          onClick={() => onChange('auto')}
          disabled={disabled}
          className={`px-3 py-1.5 font-medium transition-colors ${
            mode === 'auto'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          Auto
        </button>
        <button
          onClick={() => onChange('manual')}
          disabled={disabled}
          className={`px-3 py-1.5 font-medium transition-colors border-l border-slate-200 ${
            mode === 'manual'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          } disabled:opacity-50`}
        >
          Manual
        </button>
      </div>
      <span className="text-xs text-slate-400">
        {mode === 'auto'
          ? 'Full pipeline runs automatically'
          : 'Judge-in-the-loop at each stage'}
      </span>
    </div>
  );
}
