import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AnalysisMode,
  AnalysisReport,
  ApprovedCitation,
  ChecklistItem,
  ExtractedCitation,
  Matter,
  RetrievedCase,
} from './types';

// Pipeline stage for manual mode
export type PipelineStage =
  | 'idle'
  | 'extracting'
  | 'approval'
  | 'analyzing'
  | 'review';

interface AppStore {
  // Matter management
  matters: Matter[];
  setMatters: (m: Matter[]) => void;
  activeMatter: Matter | null;
  setActiveMatter: (m: Matter | null) => void;

  // Mode
  mode: AnalysisMode;
  setMode: (m: AnalysisMode) => void;

  // Pipeline state (shared between modes)
  stage: PipelineStage;
  setStage: (s: PipelineStage) => void;

  citations: ExtractedCitation[];
  retrievedCases: RetrievedCase[];
  setCitationsAndCases: (c: ExtractedCitation[], r: RetrievedCase[]) => void;

  approvedCitations: ApprovedCitation[];
  approveCitation: (id: string, retrieved: RetrievedCase | null, note: string | null) => void;
  rejectCitation: (id: string) => void;
  approveAll: () => void;

  report: AnalysisReport | null;
  setReport: (r: AnalysisReport) => void;

  checklist: ChecklistItem[];
  updateChecklistItem: (id: string, update: Partial<ChecklistItem>) => void;

  // UI state
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  activeDocumentView: string | null;
  setActiveDocumentView: (name: string | null) => void;
  activeTab: 'dag' | 'checklist' | 'documents';
  setActiveTab: (t: 'dag' | 'checklist' | 'documents') => void;

  error: string | null;
  setError: (e: string | null) => void;

  // Reset pipeline only (keep matter/mode)
  resetPipeline: () => void;
  // Full reset
  reset: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      matters: [],
      setMatters: (matters) => set({ matters }),
      activeMatter: null,
      setActiveMatter: (m) => set({ activeMatter: m, report: null, stage: 'idle', citations: [], retrievedCases: [], approvedCitations: [], error: null }),

      mode: 'manual',
      setMode: (mode) => set({ mode }),

      stage: 'idle',
      setStage: (stage) => set({ stage }),

      citations: [],
      retrievedCases: [],
      setCitationsAndCases: (citations, retrievedCases) => set({ citations, retrievedCases }),

      approvedCitations: [],
      approveCitation: (id, retrieved, note) => {
        const citation = get().citations.find((c) => c.id === id);
        if (!citation) return;
        const without = get().approvedCitations.filter((a) => a.citation.id !== id);
        set({
          approvedCitations: [
            ...without,
            { citation, retrieved_case: retrieved, user_approved: true, user_note: note },
          ],
        });
      },
      rejectCitation: (id) =>
        set({ approvedCitations: get().approvedCitations.filter((a) => a.citation.id !== id) }),
      approveAll: () => {
        const { citations, retrievedCases } = get();
        set({
          approvedCitations: citations.map((c) => ({
            citation: c,
            retrieved_case: retrievedCases.find((r) => r.citation_id === c.id) ?? null,
            user_approved: true,
            user_note: null,
          })),
        });
      },

      report: null,
      setReport: (report) => set({ report, checklist: report.checklist }),

      checklist: [],
      updateChecklistItem: (id, update) =>
        set({ checklist: get().checklist.map((item) => (item.id === id ? { ...item, ...update } : item)) }),

      selectedNodeId: null,
      setSelectedNodeId: (id) => set({ selectedNodeId: id }),
      activeDocumentView: null,
      setActiveDocumentView: (name) => set({ activeDocumentView: name }),
      activeTab: 'dag',
      setActiveTab: (t) => set({ activeTab: t }),

      error: null,
      setError: (error) => set({ error }),

      resetPipeline: () =>
        set({ stage: 'idle', citations: [], retrievedCases: [], approvedCitations: [], report: null, checklist: [], error: null }),

      reset: () =>
        set({
          activeMatter: null,
          stage: 'idle',
          citations: [],
          retrievedCases: [],
          approvedCitations: [],
          report: null,
          checklist: [],
          selectedNodeId: null,
          activeDocumentView: null,
          error: null,
        }),
    }),
    {
      name: 'judicial-review-session',
    },
  ),
);
