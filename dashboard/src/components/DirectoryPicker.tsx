/**
 * DirectoryPicker — modal filesystem browser for selecting an absolute path.
 *
 * Calls `/api/fs/browse?path=...` to list directories under the dashboard's
 * allowed roots (HOME, project root). Click a directory to descend, ↑ to go
 * up, "Use this directory" to commit. Loopback bind + 0700 HOME perms gate
 * access at the OS layer; the server caps reachable paths to the same roots
 * as a second line of defence.
 *
 * Open via `<DirectoryPicker onPick={(absPath) => …} onClose={…} />`. The
 * picker manages its own internal state; the parent just receives the final
 * path string.
 */

import { useEffect, useState } from 'react';
import { browseFilesystem } from '../lib/api';

type Entry = { name: string; type: 'dir' | 'file' | 'other' };
type BrowseResponse = {
  path: string;
  parent: string | null;
  roots: string[];
  entries: Entry[];
};

type Props = {
  initialPath?: string | null;
  onPick: (absPath: string) => void;
  onClose: () => void;
};

export default function DirectoryPicker({ initialPath, onPick, onClose }: Props) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (path?: string | null) => {
    setLoading(true);
    setError(null);
    browseFilesystem(path || undefined)
      .then((d: BrowseResponse) => setData(d))
      .catch((e) => setError(e?.message || 'Failed to browse filesystem'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(initialPath ?? undefined); }, [initialPath]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50" role="dialog" aria-modal="true" aria-label="Choose a directory">
      <div className="bg-surface border border-border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Choose a directory</h2>
          <button onClick={onClose} aria-label="Close" className="text-xl leading-none px-2">×</button>
        </header>

        <div className="px-4 py-2 border-b border-border text-xs text-text-muted flex items-center gap-2 flex-wrap">
          <button
            onClick={() => data?.parent && load(data.parent)}
            disabled={!data?.parent}
            className="px-2 py-1 rounded border border-border bg-bg-muted disabled:opacity-40"
            aria-label="Go up one directory"
          >↑</button>
          <code className="font-mono break-all flex-1 min-w-0">{data?.path || '…'}</code>
        </div>

        {data?.roots && (
          <div className="px-4 py-2 border-b border-border text-xs flex items-center gap-2 flex-wrap">
            <span className="text-text-dim">Jump to:</span>
            {data.roots.map((r) => (
              <button key={r} onClick={() => load(r)} className="px-2 py-0.5 rounded border border-border bg-bg-muted hover:bg-bg-emphasis font-mono">
                {r}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-1">
          {loading && <p className="text-xs text-text-dim px-2 py-3">Loading…</p>}
          {error && <p className="text-xs text-red-700 px-2 py-3">{error}</p>}
          {!loading && !error && data && data.entries.length === 0 && (
            <p className="text-xs text-text-dim px-2 py-3 italic">Empty directory.</p>
          )}
          {!loading && !error && data && data.entries.map((entry) => (
            <button
              key={entry.name}
              onClick={() => entry.type === 'dir' && load(`${data.path}/${entry.name}`)}
              disabled={entry.type !== 'dir'}
              className="w-full text-left px-2 py-1 text-sm rounded hover:bg-bg-muted disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span aria-hidden="true" className="text-base">{entry.type === 'dir' ? '📁' : '📄'}</span>
              <span className="font-mono truncate">{entry.name}</span>
              {entry.type !== 'dir' && <span className="text-[10px] text-text-dim ml-auto">file</span>}
            </button>
          ))}
        </div>

        <footer className="px-4 py-3 border-t border-border flex items-center justify-end gap-2 flex-wrap">
          <button onClick={onClose} className="btn text-xs">Cancel</button>
          <button
            onClick={() => data && onPick(data.path)}
            disabled={!data?.path}
            className="btn btn-primary text-xs disabled:opacity-50"
          >Use this directory</button>
        </footer>
      </div>
    </div>
  );
}
