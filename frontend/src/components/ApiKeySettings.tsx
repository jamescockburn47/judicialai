import { useState, useEffect } from 'react';
import { getApiKey, saveApiKey, deleteApiKey, maskKey, validateAnthropicKey } from '../keystore';
import { testApiKey } from '../api';

interface Props {
  onClose: () => void;
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export function ApiKeySettings({ onClose }: Props) {
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getApiKey().then(setCurrentKey);
  }, []);

  const handleSave = async () => {
    const key = inputKey.trim();
    if (!key) return;
    if (!validateAnthropicKey(key)) {
      setTestMsg('Key should start with sk-ant- and be at least 20 characters.');
      return;
    }
    setSaving(true);
    try {
      await saveApiKey(key);
      setCurrentKey(key);
      setInputKey('');
      setEditing(false);
      setTestMsg('');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove the stored API key? You will need to re-enter it to use AI features.')) return;
    await deleteApiKey();
    setCurrentKey(null);
    setEditing(false);
    setTestMsg('');
  };

  const handleTest = async () => {
    const key = currentKey;
    if (!key) return;
    setTestStatus('testing');
    setTestMsg('');
    try {
      const result = await testApiKey(key);
      if (result.ok) {
        setTestStatus('ok');
        setTestMsg(result.message);
      } else {
        setTestStatus('fail');
        setTestMsg(result.message);
      }
    } catch (e) {
      setTestStatus('fail');
      setTestMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">API Key</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Stored locally in your app data folder. Never shared.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Current key status */}
          {currentKey && !editing ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">
                    Anthropic API key
                  </p>
                  <p className="font-mono text-sm text-slate-700 mt-0.5">{maskKey(currentKey)}</p>
                </div>
                <span className="text-emerald-600 text-lg">✓</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={testStatus === 'testing'}
                  className="flex-1 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                >
                  {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={() => { setEditing(true); setTestMsg(''); setTestStatus('idle'); }}
                  className="flex-1 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                >
                  Change Key
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100"
                >
                  Remove
                </button>
              </div>

              {testMsg && (
                <p className={`text-xs rounded px-3 py-2 ${
                  testStatus === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {testMsg}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!currentKey && (
                <p className="text-sm text-slate-600 leading-relaxed">
                  Enter your Anthropic API key to enable AI citation validation. Your key is stored
                  only on this machine in your app data folder and sent only to{' '}
                  <span className="font-mono text-xs">api.anthropic.com</span>.
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Anthropic API key <span className="text-slate-400 font-normal">(starts with sk-ant-)</span>
                </label>
                <input
                  autoFocus
                  type="password"
                  value={inputKey}
                  onChange={(e) => { setInputKey(e.target.value); setTestMsg(''); }}
                  placeholder="sk-ant-..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              {testMsg && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {testMsg}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !inputKey.trim()}
                  className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Key'}
                </button>
                {(currentKey || editing) && (
                  <button
                    onClick={() => { setEditing(false); setInputKey(''); setTestMsg(''); }}
                    className="flex-1 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 leading-relaxed">
                <p className="font-medium text-slate-700 mb-1">How to get a key</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">console.anthropic.com</a></li>
                  <li>Create an account and add credit (min $5 — pay as you go)</li>
                  <li>Go to Settings → API Keys → Create Key</li>
                  <li>Copy the key (starts with sk-ant-) and paste above</li>
                </ol>
              </div>
            </div>
          )}

          {/* Privacy note */}
          <div className="text-xs text-slate-400 border-t border-slate-100 pt-4">
            Your key is stored in{' '}
            <span className="font-mono">%APPDATA%\ai.learnedhand.judicial-review\jr-settings.json</span>{' '}
            on this machine only. It is never written to Documents, never logged, and never sent to
            any server except <span className="font-mono">api.anthropic.com</span> when you explicitly
            run an analysis.
          </div>
        </div>
      </div>
    </div>
  );
}
