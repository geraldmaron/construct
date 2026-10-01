/**
 * kernel/state/identity.ts — the project a store belongs to.
 *
 * A store records its project's id in `meta.project_id`. A checkout can lose
 * its committed project files (a commit that never carried them) while the
 * store stays where they would be. The stamp lets every binding confirm that
 * the files and the store describe one project, and lets init refuse to mint a
 * new id over a store that already belongs to one.
 *
 * A store without a stamp is stamped by the first writable binding that knows
 * the project's id; a read-only binding leaves it unstamped and compares
 * nothing.
 */

import { getProfile } from './profile.ts';
import type { StateStore } from './open.ts';

const KEY = 'project_id';

/** The store and the project files disagree, or the files are gone while the store remains. */
export class StoreProjectError extends Error {
  /** What the person can do about it. */
  readonly next: string;

  constructor(message: string, next: string) {
    super(message);
    this.name = 'StoreProjectError';
    this.next = next;
  }
}

/** The project id this store was stamped with, or null when it predates stamping. */
export function storeProjectId(store: StateStore): string | null {
  const row = store.db.prepare('SELECT value FROM meta WHERE key = ?').get(KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Whether the store already holds a project: a stamp, or a profile written by an earlier init. */
export function storeHasProject(store: StateStore): boolean {
  return storeProjectId(store) !== null || getProfile(store) !== null;
}

/**
 * Confirm the store belongs to `projectId`, stamping it when it has no stamp,
 * the connection can write, and `stamp` allows it. A store stamped for another
 * project is refused. An id read from anywhere but the main checkout's own
 * project file only checks: stamping from it could lock out the real project.
 */
export function bindStoreToProject(store: StateStore, projectId: string, options: { readonly stamp?: boolean } = {}): void {
  const stamped = storeProjectId(store);
  if (stamped === null) {
    if (store.readOnly || options.stamp === false) return;
    store.transaction(() => {
      store.db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(KEY, projectId);
    });
    const now = storeProjectId(store);
    if (now === projectId) return;
    throw mismatch(store.path, now ?? 'none', projectId);
  }
  if (stamped !== projectId) throw mismatch(store.path, stamped, projectId);
}

function mismatch(path: string, stamped: string, projectId: string): StoreProjectError {
  return new StoreProjectError(
    `the store at ${path} belongs to project ${stamped}, but .construct/project.json names ${projectId}`,
    'One store is one project. Restore the .construct/project.json that names the store’s project, or move this store aside before running `construct init`.',
  );
}
