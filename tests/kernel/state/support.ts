/**
 * tests/kernel/state/support.ts — a fresh format-2 store in a tmpdir per test.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStateStore, type StateStore } from '../../../src/kernel/state/open.ts';

export interface StoreFixture {
  readonly root: string;
  readonly dbPath: string;
  readonly store: StateStore;
  cleanup(): void;
}

export function freshStore(): StoreFixture {
  const root = mkdtempSync(join(tmpdir(), 'construct-state2-'));
  const dbPath = join(root, '.construct', 'state', 'construct.sqlite');
  const store = openStateStore(dbPath);
  return {
    root,
    dbPath,
    store,
    cleanup: () => {
      try {
        store.close();
      } catch {
        // already closed by the test
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Deterministic clock: each call is one second later than the last. */
export function clock(start = '2026-09-02T10:00:00.000Z'): () => string {
  let t = Date.parse(start);
  return () => {
    const out = new Date(t).toISOString();
    t += 1000;
    return out;
  };
}
