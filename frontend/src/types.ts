// Matter system types
export interface Matter {
  id: string;
  name: string;
  caseNumber?: string;
  court?: string;
  description?: string;
  createdAt: string;
  isDemo?: boolean;
  primaryDocument: string;
  supportingDocuments: string[];
  documentsPath: string; // absolute path to documents folder
}

export interface MatterAnalysisCache {
  matterId: string;
  mode: AnalysisMode;
  runAt: string;
  report: AnalysisReport;
}

export type AnalysisMode = 'auto' | 'manual';

// Citation / pipeline types
export interface ExtractedCitation {
  id: string;
  citation_string: string;
  case_name: string | null;
  reporter: string;
  volume: string | null;
  page: string | null;
  pinpoint: string | null;
  year: string | null;
  court: string | null;
  location_in_doc: string;
}

export interface RetrievedCase {
  citation_id: string;
  url: string;
  source: string;
  confidence: number;
  title: string | null;
  court_name: string | null;
  decision_date: string | null;
  full_text: string | null;
  /** Number of times cited in CourtListener. 0 = fabrication signal. null = not retrieved. */
  cite_count: number | null;
  resolution_method: string;
  status: 'resolved' | 'not_found' | 'not_indexed' | 'unresolvable' | { error: string };
}

export interface ApprovedCitation {
  citation: ExtractedCitation;
  retrieved_case: RetrievedCase | null;
  user_approved: boolean;
  user_note: string | null;
}

export interface ValidationResult {
  citation_id: string;
  citation_string: string;
  proposition: string;
  verdict: 'verified' | 'suspect' | 'misused' | 'fabricated' | 'unverifiable';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  quote_accurate: boolean | null;
  quote_analysis: string | null;
  is_structural: boolean;
  flags: string[];
}

export interface ConsistencyFlag {
  id: string;
  sumf_assertion: string;
  supported_by: string[];
  contradicted_by: string[];
  status: 'supported' | 'contradicted' | 'unsupported' | 'partial';
  detail: string;
}

export interface ArgumentNode {
  id: string;
  label: string;
  node_type: 'argument' | 'citation';
  verdict: ValidationResult['verdict'] | null;
}

export interface ArgumentEdge {
  from: string;
  to: string;
  structural: boolean;
}

export interface ArgumentGraph {
  nodes: ArgumentNode[];
  edges: ArgumentEdge[];
}

export interface ChecklistItem {
  id: string;
  item_type: 'citation' | 'consistency_flag';
  label: string;
  verdict: ValidationResult['verdict'] | null;
  confidence: ValidationResult['confidence'] | null;
  status: 'pending' | 'accepted' | 'flagged' | 'rerunning';
  judge_note: string | null;
  rerun_count: number;
}

export interface AnalysisReport {
  case_name: string;
  document: string;
  validation_results: ValidationResult[];
  consistency_flags: ConsistencyFlag[];
  argument_graph: ArgumentGraph;
  judicial_memo: string;
  checklist: ChecklistItem[];
  created_at: string;
}

export interface ExtractResponse {
  citations: ExtractedCitation[];
  retrieved_cases: RetrievedCase[];
}

export interface AnalyzeRequest {
  approved_citations: ApprovedCitation[];
  document_name?: string;
  documents_path?: string;
}
