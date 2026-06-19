/**
 * apps/chat/web/components/list-picker.tsx — searchable list picker for web chat.
 *
 * Model and /set pickers mirror the Ink ListPickerOverlay interaction model.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';

export type PickerItem = {
  id: string;
  label: string;
  detail?: string | null;
  tag?: string | null;
  disabled?: boolean;
};

type ListPickerProps = {
  title: string;
  items: PickerItem[];
  selectedId?: string | null;
  onSelect: (item: PickerItem) => void;
  onCancel: () => void;
};

function filterItems(items: PickerItem[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = [item.id, item.label, item.detail, item.tag].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function ListPicker({ title, items, selectedId, onSelect, onCancel }: ListPickerProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const visible = useMemo(() => filterItems(items, query), [items, query]);

  useEffect(() => {
    const start = Math.max(0, visible.findIndex((i) => i.id === selectedId));
    setIndex(start >= 0 ? start : 0);
  }, [visible, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(0, visible.length - 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = visible[index];
        if (item && !item.disabled) onSelect(item);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, index, onCancel, onSelect]);

  return (
    <div className="cx-cockpit-picker" role="dialog" aria-label={title}>
      <p className="cx-cockpit-picker-title">{title}</p>
      <p className="cx-cockpit-muted cx-cockpit-picker-hint">
        type to filter   │   ↑/↓ move   enter select   esc cancel
      </p>
      <input
        className="cx-cockpit-picker-query"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        aria-label="Filter picker"
        autoFocus
      />
      <ul className="cx-cockpit-picker-list" role="listbox">
        {!visible.length ? (
          <li className="cx-cockpit-warn">no matches</li>
        ) : visible.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              className={`cx-cockpit-picker-item ${i === index ? 'cx-cockpit-picker-item-active' : ''}`}
              disabled={item.disabled}
              onClick={() => !item.disabled && onSelect(item)}
            >
              <span>{`${i === index ? '›' : ' '} ${String(i + 1).padStart(2)}.`}</span>
              <span>{selectedId === item.id ? ' ● ' : '   '}</span>
              <span>{item.label || item.id}</span>
              {item.tag ? <span className="cx-cockpit-muted">{` [${item.tag}]`}</span> : null}
              {item.detail ? <span className="cx-cockpit-muted">{` — ${item.detail}`}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
