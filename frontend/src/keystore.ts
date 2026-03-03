/**
 * API key storage — uses Tauri Store plugin (persisted to AppData, user-specific).
 * Only Anthropic for now (Claude Sonnet + Opus). Key is never written to Documents
 * and never leaves the machine except when explicitly sent to api.anthropic.com.
 *
 * Store file: %APPDATA%\ai.learnedhand.judicial-review\jr-settings.json
 */

const STORE_FILE = 'jr-settings.json';
const KEY_ANTHROPIC = 'anthropic_api_key';

const isTauri = () => '__TAURI_INTERNALS__' in window;

async function getStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  return load(STORE_FILE);
}

export async function getApiKey(): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem('jr_anthropic_key');
  try {
    const store = await getStore();
    const val = await store.get<string>(KEY_ANTHROPIC);
    return val ?? null;
  } catch (e) {
    console.error('getApiKey failed:', e);
    return null;
  }
}

export async function saveApiKey(key: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem('jr_anthropic_key', key);
    return;
  }
  const store = await getStore();
  await store.set(KEY_ANTHROPIC, key);
  await store.save();
}

export async function deleteApiKey(): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem('jr_anthropic_key');
    return;
  }
  const store = await getStore();
  await store.delete(KEY_ANTHROPIC);
  await store.save();
}

export function maskKey(key: string): string {
  if (key.length < 12) return '••••••••';
  return key.slice(0, 10) + '••••••••' + key.slice(-4);
}

export function validateAnthropicKey(key: string): boolean {
  return key.trim().startsWith('sk-ant-') && key.trim().length > 20;
}
