/**
 * kernel/store/erasure.ts — removing a person or organization from the store
 * when they ask to be removed.
 *
 * Every evidence table here is append-only, and for everything else that is
 * simply right: a work log that can be edited is not a record of anything.
 * Records and notes are the exception, and not because the discipline is
 * weaker there — because of what they hold. A record is facts about a named
 * subject and a note is the words a person said about them, which is precisely
 * what an erasure request under Article 17 is about. "The store is append-only"
 * is not an answer to that request; it is a description of why the store cannot
 * give one.
 *
 * So deletion is refused by default and permitted only inside an erasure. The
 * unlock is a marker written to `meta` for the length of one transaction, which
 * the delete triggers check: there is no way to remove a row except through
 * this module, and no way for this module to remove one without leaving the
 * `erasures` row that says it happened. That row carries the fact, the count
 * and the stated reason, and no content of its own — an erasure log that
 * quoted what it erased would be the leak it exists to close.
 *
 * What this deliberately does not do is guess. A note naming two subjects is
 * evidence about both, and destroying it to satisfy one would destroy the
 * other's record without anybody asking. Those notes are reported, named, and
 * left; whether they go is a judgment with a person's interests on both sides
 * of it, and the store is not the place that judgment gets made.
 */

import type { Store } from './open.ts';
import { transact } from './open.ts';
import { getRecord } from './records.ts';
import { noteNames } from '../context/subjects.ts';
import type { Note } from './notes.ts';

const UNLOCK = 'erasure_unlocked';

export const ERASURE_KINDS = ['record', 'note'] as const;

export type ErasureKind = (typeof ERASURE_KINDS)[number];

export interface Erasure {
  readonly workspace: string;
  readonly kind: ErasureKind;
  /** The id that was removed. An id, never a name: the name is the thing erased. */
  readonly subject: string;
  readonly reason: string;
  /** Rows removed, so a count can be audited without the content being kept. */
  readonly removed: number;
  readonly erasedAt: string;
}

/**
 * Run `body` with deletion permitted, and always take the permission back.
 *
 * The marker is written and cleared inside the caller's transaction, so a
 * failure anywhere rolls back both the deletion and the unlock. A store left
 * unlocked by a crash mid-erasure would be a store whose append-only guarantee
 * quietly stopped holding, which is worse than an erasure that did not finish.
 */
function unlocked<T>(store: Store, body: () => T): T {
  store.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')").run(UNLOCK);
  try {
    return body();
  } finally {
    store.db.prepare('DELETE FROM meta WHERE key = ?').run(UNLOCK);
  }
}

export interface RecordErasure {
  readonly erased: Erasure;
  /**
   * Notes that still say this subject's name. Reported rather than removed:
   * a note naming two subjects is evidence about both, and taking it for one
   * of them destroys the other's record with nobody having asked.
   */
  readonly notesStillNaming: readonly Note[];
}

/**
 * Erase one record: the subject, every value its fields ever held, and the
 * history of how they got there. Refuses an unknown record rather than
 * reporting a success nobody received.
 *
 * The returned notes are the honest remainder. A caller that presents this as
 * complete erasure without saying what is left is making a claim this function
 * does not support.
 */
export function eraseRecord(
  store: Store,
  record: string,
  reason: string,
  at: string,
): RecordErasure {
  if (reason.trim() === '') {
    throw new Error('eraseRecord: an erasure with no stated reason is not auditable');
  }
  const subject = getRecord(store, record);
  if (!subject) throw new Error(`eraseRecord: no record ${record}`);

  const naming = notesNaming(store, subject.workspace, subject.name);

  return transact(store, () => {
    const removed = unlocked(store, () => {
      const fields = store.db
        .prepare('DELETE FROM record_fields WHERE record = ?')
        .run(record).changes;
      store.db.prepare('DELETE FROM records WHERE id = ?').run(record);
      return Number(fields) + 1;
    });
    const erased: Erasure = {
      workspace: subject.workspace,
      kind: 'record',
      subject: record,
      reason: reason.trim(),
      removed,
      erasedAt: at,
    };
    recordErasure(store, erased);
    return { erased, notesStillNaming: naming };
  });
}

/**
 * Erase one note: the words themselves. Citations into it stop resolving,
 * which is correct — a lesson or a field justified by words that no longer
 * exist should not go on presenting itself as justified.
 */
export function eraseNote(store: Store, note: string, reason: string, at: string): Erasure {
  if (reason.trim() === '') {
    throw new Error('eraseNote: an erasure with no stated reason is not auditable');
  }
  const row = store.db.prepare('SELECT workspace FROM notes WHERE id = ?').get(note) as
    | { workspace: string }
    | undefined;
  if (!row) throw new Error(`eraseNote: no note ${note}`);

  return transact(store, () => {
    const removed = unlocked(
      store,
      () => Number(store.db.prepare('DELETE FROM notes WHERE id = ?').run(note).changes),
    );
    const erased: Erasure = {
      workspace: row.workspace,
      kind: 'note',
      subject: note,
      reason: reason.trim(),
      removed,
      erasedAt: at,
    };
    recordErasure(store, erased);
    return erased;
  });
}

function recordErasure(store: Store, erasure: Erasure): void {
  store.db
    .prepare(
      `INSERT INTO erasures (workspace, kind, subject, reason, removed, erased_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      erasure.workspace,
      erasure.kind,
      erasure.subject,
      erasure.reason,
      erasure.removed,
      erasure.erasedAt,
    );
}

/** Notes in a workspace whose text says this name, by the same match the loop scopes with. */
export function notesNaming(store: Store, workspace: string, name: string): Note[] {
  const rows = store.db
    .prepare('SELECT * FROM notes WHERE workspace = ? ORDER BY recorded_at, id')
    .all(workspace) as unknown as Array<{
    id: string;
    workspace: string;
    run: string | null;
    door: string;
    body: string;
    recorded_at: string;
  }>;
  return rows
    .filter((row) => noteNames(row.body, name))
    .map((row) => ({
      id: row.id,
      workspace: row.workspace,
      run: row.run,
      door: row.door as Note['door'],
      body: row.body,
      recordedAt: row.recorded_at,
    }));
}

/** Every erasure a workspace has performed, oldest first. Holds no erased content. */
export function erasuresFor(store: Store, workspace: string): Erasure[] {
  const rows = store.db
    .prepare('SELECT * FROM erasures WHERE workspace = ? ORDER BY seq')
    .all(workspace) as unknown as Array<{
    workspace: string;
    kind: string;
    subject: string;
    reason: string;
    removed: number;
    erased_at: string;
  }>;
  return rows.map((row) => ({
    workspace: row.workspace,
    kind: row.kind as ErasureKind,
    subject: row.subject,
    reason: row.reason,
    removed: Number(row.removed),
    erasedAt: row.erased_at,
  }));
}
