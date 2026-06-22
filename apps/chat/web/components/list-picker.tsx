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
  group?: string | null;
  badges?: string[];
  price?: string | null;
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

  // Selectable-model count per group (hint/disabled rows excluded) so each header
  // shows the scale of its section in the current view before scrolling.
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of visible as PickerItem[]) {
      if (!item.group || item.disabled) continue;
      counts.set(item.group, (counts.get(item.group) || 0) + 1);
    }
    return counts;
  }, [visible]);

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
          ) : visible.map((item: PickerItem, i: number) => {
            const prevGroup = i > 0 ? (visible[i - 1] as PickerItem).group : undefined;
            const showHeader = item.group && item.group !== prevGroup;
            const isActive = i === pickerState.index;
            const isSelected = selectedId === item.id;
            return (
              <li key={item.id}>
                {showHeader ? (
                  <p className="cx-cockpit-picker-group" role="presentation">
                    <span>{item.group}</span>
                    {groupCounts.get(item.group as string) ? (
                      <span className="cx-cockpit-picker-group-count">{groupCounts.get(item.group as string)}</span>
                    ) : null}
                  </p>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`cx-cockpit-picker-item ${isActive ? 'cx-cockpit-picker-item-active' : ''} ${item.disabled ? 'cx-cockpit-picker-item-hint' : ''}`}
                  disabled={item.disabled}
                  onClick={() => !item.disabled && onSelect(item)}
                >
                  <span className="cx-cockpit-picker-mark" aria-hidden="true">{isSelected ? '●' : isActive ? '›' : ''}</span>
                  <span className="cx-cockpit-picker-mid">
                    <span className="cx-cockpit-picker-row">
                      <span className="cx-cockpit-picker-name">{item.label || item.id}</span>
                      {item.tag ? <span className={`cx-cockpit-badge cx-cockpit-badge-${item.tag}`}>{item.tag}</span> : null}
                      {(item.badges || []).map((b: string) => (
                        <span key={b} className={`cx-cockpit-badge cx-cockpit-badge-${b}`}>{b}</span>
                      ))}
                    </span>
                    {item.detail ? <span className="cx-cockpit-picker-sub">{item.detail}</span> : null}
                  </span>
                  <span className="cx-cockpit-picker-meta">{item.price || ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
