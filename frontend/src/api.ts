import axios from 'axios';
import type { AnalysisReport, AnalyzeRequest, ExtractResponse, ValidationResult } from './types';
import { getApiKey } from './keystore';

async function makeClient() {
  const key = await getApiKey();
  return axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8002',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'X-Anthropic-Key': key } : {}),
    },
    timeout: 300_000,
  });
}

export async function extractCitations(documentName: string, documentsPath: string): Promise<ExtractResponse> {
  const client = await makeClient();
  const { data } = await client.post<ExtractResponse>('/extract', {
    document_name: documentName,
    documents_path: documentsPath || undefined,
  });
  return data;
}

export async function analyzeDocument(body: AnalyzeRequest): Promise<AnalysisReport> {
  const client = await makeClient();
  const { data } = await client.post<AnalysisReport>('/analyze', body);
  return data;
}

export async function rerunCitation(
  citationId: string,
  judgeNote: string,
): Promise<{ updated_result: ValidationResult }> {
  const client = await makeClient();
  const { data } = await client.post('/rerun', {
    citation_id: citationId,
    judge_note: judgeNote,
  });
  return data;
}

export async function getReport(): Promise<AnalysisReport> {
  const client = await makeClient();
  const { data } = await client.get<AnalysisReport>('/report');
  return data;
}

export async function testApiKey(key: string): Promise<{ ok: boolean; message: string }> {
  const client = axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8002',
    headers: { 'Content-Type': 'application/json', 'X-Anthropic-Key': key },
    timeout: 30_000,
  });
  try {
    const { data } = await client.post<{ ok: boolean; message: string }>('/test-key');
    return data;
  } catch (e: unknown) {
    if (axios.isAxiosError(e) && e.response?.data) {
      return e.response.data as { ok: boolean; message: string };
    }
    return { ok: false, message: e instanceof Error ? e.message : 'Unknown error' };
  }
}
