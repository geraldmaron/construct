/**
 * kernel/store/notes.ts — the notes store: what arrived after a call, before
 * anything was concluded from it.
 *
 * A note enters through one of two doors — a file drop or a host session —
 * and both land in the same row shape, because the door is a fact about
 * arrival, not about trust. The note's body is the evidence every context-loop
 * output must cite: a memory delta or a propagation proposal justifies itself
 * by naming a note line, and the citation format lives here so the loop and
 * the store cannot drift on what a note citation looks like.
 *
 * Append-only, enforced by triggers. A citation that points into an editable
 * note would be provenance for whatever the note says now, not for what the
 * user said, and that is the fabrication class the hard gates exist for.
 */

import type { Store } from './open.ts';

export const NOTE_DOORS = ['file-drop', 'host-session'] as const;

export type NoteDoor = (typeof NOTE_DOORS)[number];

export interface Note {
  readonly id: string;
  readonly workspace: string;
  readonly run: string | null;
  readonly door: NoteDoor;
  readonly body: string;
  readonly recordedAt: string;
}

interface Row {
  readonly id: string;
  readonly workspace: string;
  readonly run: string | null;
  readonly door: string;
  readonly body: string;
  readonly recorded_at: string;
}

function toNote(row: Row): Note {
  return {
    id: row.id,
    workspace: row.workspace,
    run: row.run,
    door: row.door as NoteDoor,
    body: row.body,
    recordedAt: row.recorded_at,
  };
}

/** Record a note as it arrived. The only way a note enters the store. */
export function recordNote(store: Store, note: Note): void {
  if (!(NOTE_DOORS as readonly string[]).includes(note.door)) {
    throw new Error(`recordNote: unknown door "${note.door}" (doors: ${NOTE_DOORS.join(', ')})`);
  }
  if (note.workspace.trim() === '') {
    throw new Error(`recordNote: ${note.id} has no workspace`);
  }
  if (note.body.trim() === '') {
    // An empty note can be cited but never checked against; nothing may
    // justify itself by pointing at silence.
    throw new Error(`recordNote: ${note.id} has no body`);
  }
  store.db
    .prepare(
      `INSERT INTO notes (id, workspace, run, door, body, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(note.id, note.workspace, note.run, note.door, note.body, note.recordedAt);
}

export function getNote(store: Store, id: string): Note | null {
  const row = store.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined;
  return row ? toNote(row) : null;
}

/** A workspace's notes, oldest first. */
export function notesFor(store: Store, workspace: string): Note[] {
  const rows = store.db
    .prepare('SELECT * FROM notes WHERE workspace = ? ORDER BY recorded_at, id')
    .all(workspace) as unknown as Row[];
  return rows.map(toNote);
}

/** The citation form a context-loop output uses to name its justifying line. */
export function noteCitation(noteId: string, line: number): string {
  return `note:${noteId}#L${line}`;
}

const NOTE_CITATION = /^note:([^#\s]+)#L(\d+)$/;

export interface NoteCitation {
  readonly note: string;
  /** 1-indexed, matching how a person reads the note back. */
  readonly line: number;
}

/** Parse a note citation, or null if the string is not one. */
export function parseNoteCitation(citation: string): NoteCitation | null {
  const match = NOTE_CITATION.exec(citation.trim());
  if (!match) return null;
  const line = Number(match[2]);
  if (line < 1) return null;
  return { note: match[1] as string, line };
}

/**
 * Resolve a citation to the actual line text it names, or null when the note
 * does not exist or the line is past the end. A citation that resolves to
 * nothing is a justification pointing at nothing, and callers refuse it.
 */
export function resolveNoteCitation(
  store: Store,
  citation: string,
): { readonly note: Note; readonly line: number; readonly text: string } | null {
  const parsed = parseNoteCitation(citation);
  if (!parsed) return null;
  const note = getNote(store, parsed.note);
  if (!note) return null;
  const lines = note.body.split('\n');
  const text = lines[parsed.line - 1];
  if (text === undefined) return null;
  return { note, line: parsed.line, text };
}
