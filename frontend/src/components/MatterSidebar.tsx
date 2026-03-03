import { useState } from 'react';
import type { Matter } from '../types';
import { useAppStore } from '../store';
import { createMatter, pickDocuments } from '../matters';

interface Props {
  matters: Matter[];
  onMatterCreated: (m: Matter) => void;
}

export function MatterSidebar({ matters, onMatterCreated }: Props) {
  const { activeMatter, setActiveMatter } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCaseNo, setNewCaseNo] = useState('');
  const [newCourt, setNewCourt] = useState('');
  const [pickedFiles, setPickedFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const handlePickFiles = async () => {
    const files = await pickDocuments();
    setPickedFiles(files);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const m = await createMatter(newName.trim(), newCaseNo, newCourt, pickedFiles);
      onMatterCreated(m);
      setCreating(false);
      setNewName('');
      setNewCaseNo('');
      setNewCourt('');
      setPickedFiles([]);
    } catch (e) {
      console.error('Failed to create matter:', e);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setCreating(false);
    setNewName('');
    setNewCaseNo('');
    setNewCourt('');
    setPickedFiles([]);
  };

  return (
    <aside className="w-56 shrink-0 bg-slate-900 flex flex-col h-full">
      <div className="px-4 py-4 border-b border-slate-700">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Matters</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {matters.map((m) => (
          <button
            key={m.id}
            onClick={() => setActiveMatter(m)}
            className={`w-full text-left px-4 py-3 text-sm transition-colors ${
              activeMatter?.id === m.id
                ? 'bg-indigo-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span className="block font-medium leading-snug truncate">{m.name}</span>
            {m.caseNumber && (
              <span className="block text-xs opacity-60 mt-0.5 truncate">{m.caseNumber}</span>
            )}
            {m.isDemo && (
              <span className="inline-block mt-1 text-[10px] bg-indigo-500/30 text-indigo-300 rounded px-1.5 py-0.5">
                demo
              </span>
            )}
          </button>
        ))}

        {matters.length === 0 && (
          <p className="px-4 py-3 text-xs text-slate-500">Loading matters...</p>
        )}
      </nav>

      <div className="px-4 py-3 border-t border-slate-700">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-xs text-slate-400 hover:text-white py-1.5 flex items-center gap-1.5"
          >
            <span className="text-base leading-none">+</span> New Matter
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Matter name *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full text-xs bg-slate-800 text-white border border-slate-600 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
            />
            <input
              type="text"
              placeholder="Case number"
              value={newCaseNo}
              onChange={(e) => setNewCaseNo(e.target.value)}
              className="w-full text-xs bg-slate-800 text-white border border-slate-600 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
            />
            <input
              type="text"
              placeholder="Court"
              value={newCourt}
              onChange={(e) => setNewCourt(e.target.value)}
              className="w-full text-xs bg-slate-800 text-white border border-slate-600 rounded px-2 py-1.5 focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={handlePickFiles}
              className="w-full text-xs bg-slate-700 text-slate-200 rounded py-1.5 hover:bg-slate-600 text-left px-2"
            >
              {pickedFiles.length === 0
                ? '+ Add documents...'
                : `${pickedFiles.length} document${pickedFiles.length > 1 ? 's' : ''} selected`}
            </button>
            {pickedFiles.length > 0 && (
              <ul className="text-[10px] text-slate-400 pl-1 space-y-0.5 max-h-20 overflow-y-auto">
                {pickedFiles.map((f) => (
                  <li key={f} className="truncate">{f.split(/[\\/]/).pop()}</li>
                ))}
              </ul>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={handleCreate}
                disabled={busy || !newName.trim()}
                className="flex-1 text-xs bg-indigo-600 text-white rounded py-1.5 hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? '...' : 'Create'}
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 text-xs bg-slate-700 text-slate-300 rounded py-1.5 hover:bg-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
