/**
 * kernel/store/records.ts — the things a workspace keeps facts about: a
 * customer, an account, a vendor, a programme.
 *
 * Workspace memory already held what a note taught, as lessons keyed by a
 * free-text domain. That is the right shape for a durable operating fact
 * ("this client decides scope by quarter") and the wrong one for a fact about
 * a particular subject ("Acme's renewal moved to Q3"): the second belongs to
 * Acme, not to the workspace, and keyed only by a domain string it could
 * neither be listed, superseded per subject, nor told apart from a fact about
 * a different client filed under the same word. The only isolation available
 * was one workspace per subject, which also isolates the memory you wanted
 * shared across all of them.
 *
 * A record is a named subject. Its fields are append-only: a field's current
 * value is its most recent row, and the rows before it are how it got there.
 * Every field update carries the note citation that taught it, and the store
 * refuses one that carries none — the same discipline the context loop's other
 * outputs are held to, for the same reason. A record's history is evidence,
 * so it is written once and never edited; the record itself carries only what
 * identifies it, and identity does not change without becoming a different
 * record.
 */

import type { Store } from './open.ts';

export interface RecordSubject {
  readonly id: string;
  readonly workspace: string;
  /** What kind of thing this is: customer, vendor, account, programme. */
  readonly kind: string;
  /** What it is called, as a person would say it. */
  readonly name: string;
  readonly createdAt: string;
}

export interface RecordField {
  readonly record: string;
  readonly field: string;
  readonly value: string;
  /** A note citation (`note:<id>#L<n>`): the words that taught this value. */
  readonly citation: string;
  readonly recordedAt: string;
}

interface SubjectRow {
  readonly id: string;
  readonly workspace: string;
  readonly kind: string;
  readonly name: string;
  readonly created_at: string;
}

interface FieldRow {
  readonly record: string;
  readonly field: string;
  readonly value: string;
  readonly citation: string;
  readonly recorded_at: string;
}

function toSubject(row: SubjectRow): RecordSubject {
  return {
    id: row.id,
    workspace: row.workspace,
    kind: row.kind,
    name: row.name,
    createdAt: row.created_at,
  };
}

function toField(row: FieldRow): RecordField {
  return {
    record: row.record,
    field: row.field,
    value: row.value,
    citation: row.citation,
    recordedAt: row.recorded_at,
  };
}

/**
 * Create a record. A workspace may not hold two records of the same kind under
 * the same name: the second would silently split one subject's history in two,
 * and half a history reads exactly like a whole one.
 */
export function addRecord(store: Store, subject: RecordSubject): void {
  if (subject.kind.trim() === '') throw new Error(`addRecord: ${subject.id} has no kind`);
  if (subject.name.trim() === '') throw new Error(`addRecord: ${subject.id} has no name`);
  store.db
    .prepare('INSERT INTO records (id, workspace, kind, name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(subject.id, subject.workspace, subject.kind.trim(), subject.name.trim(), subject.createdAt);
}

export function getRecord(store: Store, id: string): RecordSubject | null {
  const row = store.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
    | unknown as SubjectRow
    | undefined;
  return row ? toSubject(row) : null;
}

/** Every record a workspace keeps, by kind then name so a listing reads stably. */
export function recordsFor(store: Store, workspace: string): RecordSubject[] {
  const rows = store.db
    .prepare('SELECT * FROM records WHERE workspace = ? ORDER BY kind, name')
    .all(workspace) as unknown as SubjectRow[];
  return rows.map(toSubject);
}

/** Find a record by what a person would call it, within one workspace. */
export function findRecord(
  store: Store,
  workspace: string,
  kind: string,
  name: string,
): RecordSubject | null {
  const row = store.db
    .prepare('SELECT * FROM records WHERE workspace = ? AND kind = ? AND name = ?')
    .get(workspace, kind.trim(), name.trim()) as unknown as SubjectRow | undefined;
  return row ? toSubject(row) : null;
}

/**
 * Record what a field is now. Append-only: this supersedes the previous value
 * without erasing it, so "when did the renewal move, and what said so" is a
 * question the store can answer rather than one the store destroyed.
 *
 * An uncited update is refused. A fact about a subject with nothing behind it
 * is the fabrication class every gate in this system exists for, and a record
 * is exactly the surface where an uncited fact would be quoted later as
 * though someone had established it.
 */
export function updateRecordField(store: Store, update: RecordField): void {
  if (update.field.trim() === '') throw new Error('updateRecordField: no field named');
  if (update.value.trim() === '') throw new Error('updateRecordField: no value given');
  if (update.citation.trim() === '') {
    throw new Error(
      `updateRecordField: ${update.field} cites nothing — a fact about a subject with ` +
        'nothing behind it is not a record of anything',
    );
  }
  store.db
    .prepare(
      `INSERT INTO record_fields (record, field, value, citation, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(update.record, update.field.trim(), update.value.trim(), update.citation.trim(), update.recordedAt);
}

/** What every field of a record says now, most recently changed first. */
export function currentFields(store: Store, record: string): RecordField[] {
  const rows = store.db
    .prepare(
      `SELECT record, field, value, citation, recorded_at FROM record_fields
       WHERE seq IN (SELECT MAX(seq) FROM record_fields WHERE record = ? GROUP BY field)
       ORDER BY seq DESC`,
    )
    .all(record) as unknown as FieldRow[];
  return rows.map(toField);
}

/** How one field got to where it is, oldest first. */
export function fieldHistory(store: Store, record: string, field: string): RecordField[] {
  const rows = store.db
    .prepare('SELECT * FROM record_fields WHERE record = ? AND field = ? ORDER BY seq')
    .all(record, field.trim()) as unknown as FieldRow[];
  return rows.map(toField);
}
