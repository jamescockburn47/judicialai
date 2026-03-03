import type { ValidationResult } from '../types';

type Verdict = ValidationResult['verdict'];

const VERDICT_STYLES: Record<Verdict, string> = {
  verified: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  suspect: 'bg-amber-100 text-amber-800 border-amber-200',
  misused: 'bg-orange-100 text-orange-800 border-orange-200',
  fabricated: 'bg-red-100 text-red-800 border-red-200',
  unverifiable: 'bg-gray-100 text-gray-600 border-gray-200',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  verified: 'Verified',
  suspect: 'Suspect',
  misused: 'Misused',
  fabricated: 'Fabricated',
  unverifiable: 'Unverifiable',
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${VERDICT_STYLES[verdict]}`}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function verdictColor(verdict: Verdict | null | undefined): string {
  if (!verdict) return '#94a3b8';
  const map: Record<Verdict, string> = {
    verified: '#10b981',
    suspect: '#f59e0b',
    misused: '#f97316',
    fabricated: '#ef4444',
    unverifiable: '#94a3b8',
  };
  return map[verdict];
}
