/**
 * CommandPalette.tsx — global ⌘K navigator.
 *
 * Single consistent nav primitive: every page is reachable from a
 * keyboard-only flow without searching the sidebar. Opens on ⌘K /
 * Ctrl+K, ESC to close, arrow keys to move, Enter to navigate.
 * Type-ahead filter on the page label. Designed for the neurodivergent-
 * forward accessibility pass: a single predictable entry point that
 * doesn't depend on visual scanning.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export type CommandItem = { path: string; label: string };

export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setCursor(0);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  if (!open) return null;

  const filtered = items.filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase()));
  const safeCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(filtered.length - 1, c + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[safeCursor];
      if (item) { navigate(item.path); setOpen(false); }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: '90%',
          maxWidth: '560px',
          padding: 0,
          background: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Jump to page…"
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onInputKey}
          className="w-full p-4 bg-surface text-text border-b border-border focus:outline-none"
          style={{ fontSize: '1rem' }}
        />
        <ul className="max-h-96 overflow-y-auto" role="listbox">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-text-dim">No matches.</li>
          )}
          {filtered.map((item, i) => (
            <li
              key={item.path}
              role="option"
              aria-selected={i === safeCursor}
              className="px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between"
              style={i === safeCursor ? {
                background: 'var(--bg-muted)',
                borderLeft: '2px solid var(--aurora-cyan)',
              } : {}}
              onMouseEnter={() => setCursor(i)}
              onClick={() => { navigate(item.path); setOpen(false); }}
            >
              <span>{item.label}</span>
              <span className="text-xs text-text-dim font-mono">{item.path}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 text-xs text-text-dim border-t border-border flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
