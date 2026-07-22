/**
 * Editorial ⌘K / ⌃K command palette. App-agnostic — palette items are passed
 * in by the host. Keyboard nav (arrows, enter, esc) and overlay click-out are
 * built in. Hosts can supply `onNavigate` for client-side routing; without
 * it, item.href is taken as a hard navigation.
 */

'use client';

import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import { SearchIcon } from './icons';

export type PaletteItem = {
  kind: 'page' | 'cmd' | 'tip';
  title: string;
  sub: string;
  glyph: string;
  href?: string;
  onSelect?: () => void;
};

type Props = {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
  onNavigate?: (href: string) => void;
};

const GROUP_LABELS: Record<PaletteItem['kind'], string> = {
  page: 'Pages',
  cmd: 'Commands',
  tip: 'Tips',
};

export function CommandPalette({ open, items, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      p.title.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q),
    );
  }, [query, items]);

  useEffect(() => { setActive(0); }, [query, open]);

  const select = useCallback((item: PaletteItem | undefined) => {
    if (!item) return onClose();
    if (item.onSelect) {
      item.onSelect();
    } else if (item.href && onNavigate) {
      onNavigate(item.href);
    } else if (item.href) {
      window.location.href = item.href;
    }
    onClose();
  }, [onClose, onNavigate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        select(filtered[active]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose, select]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  if (!open) return null;

  const groups: Record<PaletteItem['kind'], (PaletteItem & { idx: number })[]> = {
    page: [], cmd: [], tip: [],
  };
  filtered.forEach((p, i) => groups[p.kind].push({ ...p, idx: i }));

  return (
    <div className="cp-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="cp-card" onClick={(e) => e.stopPropagation()}>
        <div className="cp-input-row">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cp-list">
          {(Object.entries(groups) as [PaletteItem['kind'], (PaletteItem & { idx: number })[]][]).map(
            ([k, kindItems]) => kindItems.length > 0 && (
              <Fragment key={k}>
                <div className="cp-section-label">{GROUP_LABELS[k]}</div>
                {kindItems.map((it) => (
                  <div
                    key={it.title}
                    className={'cp-item' + (it.idx === active ? ' active' : '')}
                    onMouseEnter={() => setActive(it.idx)}
                    onClick={() => select(it)}
                  >
                    <div className="cp-glyph">{it.glyph}</div>
                    <div className="cp-meta">
                      <div className="cp-title">{it.title}</div>
                      <div className="cp-sub">{it.sub}</div>
                    </div>
                    <span className="kbd">↵</span>
                  </div>
                ))}
              </Fragment>
            ),
          )}
          {filtered.length === 0 && (
            <div style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
