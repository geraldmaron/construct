/**
 * apps/chat/web/components/list-picker.tsx — searchable list picker for web chat.
 *
 * Full-screen modal anchored above the prompt. Keyboard routing matches Ink via
 * lib/chat/list-picker.mjs so arrow keys move selection instead of the chat log.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createListPickerState,
  getPickerVisibleItems,
} from '../../../../lib/chat/list-picker.mjs';
import {
  commitWebPickerSelection,
  isPickerNavigationKey,
  reduceWebPickerKey,
} from '../../../../lib/chat/web-picker-keys.mjs';

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

export function ListPicker({ title, items, selectedId, onSelect, onCancel }: ListPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [pickerState, setPickerState] = useState(() => createListPickerState({
    kind: 'model',
    title,
    items,
    selectedId,
  }));

  useEffect(() => {
    setPickerState(createListPickerState({
      kind: 'model',
      title,
      items,
      selectedId,
    }));
    queryRef.current?.focus();
  }, [title, items, selectedId]);

  useEffect(() => {
    document.body.classList.add('cx-cockpit-picker-open');
    return () => document.body.classList.remove('cx-cockpit-picker-open');
  }, []);

  const visible = useMemo(
    () => getPickerVisibleItems(pickerState),
    [pickerState],
  );

  const applyKey = useCallback((event: KeyboardEvent | React.KeyboardEvent) => {
    if (!isPickerNavigationKey(event.key)) return false;
    const { state, action } = reduceWebPickerKey(pickerState, event);
    event.preventDefault();
    event.stopPropagation();
    if (action === 'cancel') {
      onCancel();
      return true;
    }
    if (action === 'commit') {
      const { ok, item } = commitWebPickerSelection(state || pickerState);
      if (ok && item) onSelect(item);
      return true;
    }
    if (state) setPickerState(state);
    return true;
  }, [onCancel, onSelect, pickerState]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      applyKey(event);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [applyKey]);

  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [pickerState.index, visible.length]);

  return (
    <div className="cx-cockpit-picker-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}>
      <div
        ref={dialogRef}
        className="cx-cockpit-picker"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="cx-cockpit-picker-title">{title}</p>
        <p className="cx-cockpit-muted cx-cockpit-picker-hint">
          type to filter   │   ↑/↓ move   enter select   esc cancel
        </p>
        <input
          ref={queryRef}
          className="cx-cockpit-picker-query"
          value={pickerState.query || ''}
          onChange={(e) => {
            setPickerState(createListPickerState({
              kind: pickerState.kind,
              title,
              items,
              selectedId,
              query: e.target.value,
            }));
          }}
          onKeyDown={(e) => {
            if (isPickerNavigationKey(e.key)) applyKey(e);
          }}
          aria-label="Filter picker"
          autoFocus
        />
        <ul ref={listRef} className="cx-cockpit-picker-list" role="listbox" aria-label={title}>
          {!visible.length ? (
            <li className="cx-cockpit-warn">no matches</li>
          ) : visible.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === pickerState.index}
                className={`cx-cockpit-picker-item ${i === pickerState.index ? 'cx-cockpit-picker-item-active' : ''}`}
                disabled={item.disabled}
                onClick={() => !item.disabled && onSelect(item)}
              >
                <span>{`${i === pickerState.index ? '›' : ' '} ${String(i + 1).padStart(2)}.`}</span>
                <span>{selectedId === item.id ? ' ● ' : '   '}</span>
                <span>{item.label || item.id}</span>
                {item.tag ? <span className="cx-cockpit-muted">{` [${item.tag}]`}</span> : null}
                {item.detail ? <span className="cx-cockpit-muted">{` — ${item.detail}`}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
