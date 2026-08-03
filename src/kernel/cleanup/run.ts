/**
 * kernel/cleanup/run.ts — scope/risk filtering and execution over a cleanup
 * catalog. Pure over an injected CleanupItem[]; no ambient state.
 */

import type { CleanupItem } from './catalog.ts';

export interface CleanupOptions {
  readonly scope: 'project' | 'machine' | 'all';
  readonly all: boolean;
  readonly keepState: boolean;
}

export interface CleanupOutcome {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface CleanupResult {
  readonly removed: CleanupOutcome[];
  readonly skipped: CleanupOutcome[];
}

const KEEP_STATE_EXCLUDED_IDS = new Set(['project-state', 'project-scaffold']);

export function detectedItems(catalog: CleanupItem[], options: CleanupOptions): CleanupItem[] {
  return catalog.filter((item) => {
    if (options.scope !== 'all' && item.scope !== options.scope) return false;
    if (options.keepState && (item.scope === 'machine' || KEEP_STATE_EXCLUDED_IDS.has(item.id))) return false;
    return item.detect();
  });
}

/** Items a non-interactive run would act on: auto-risk always, ask-risk only under --all. */
export function selectedItems(items: CleanupItem[], all: boolean): CleanupItem[] {
  return items.filter((item) => item.risk === 'auto' || all);
}

export function applyCleanup(items: CleanupItem[], toRemoveIds: ReadonlySet<string>): CleanupResult {
  const removed: CleanupOutcome[] = [];
  const skipped: CleanupOutcome[] = [];
  for (const item of items) {
    if (!toRemoveIds.has(item.id)) {
      skipped.push({ id: item.id, label: item.label, detail: 'skipped' });
      continue;
    }
    try {
      removed.push({ id: item.id, label: item.label, detail: item.remove() });
    } catch (err) {
      removed.push({ id: item.id, label: item.label, detail: `error: ${(err as Error).message}` });
    }
  }
  return { removed, skipped };
}
