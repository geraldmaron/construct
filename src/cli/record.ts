/**
 * cli/record.ts — the subjects a workspace keeps facts about, and the erasure
 * that takes one back out.
 */

import {
  addRecord,
  currentFields,
  fieldHistory,
  findRecord,
  getRecord,
  recordsFor,
} from '../kernel/store/records.ts';
import { eraseNote, eraseRecord } from '../kernel/store/erasure.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';

const RECORD_USAGE =
  'usage: construct record add --kind=<customer|vendor|…> --name=<what it is called> [--workspace=<name>]\n' +
  '       construct record list [--workspace=<name>]\n' +
  '       construct record show <record-id> [--field=<name>]\n' +
  '       construct record erase <record-id> --reason=<why>\n' +
  '       construct record erase-note <note-id> --reason=<why>\n';

/**
 * Declare and read the subjects a workspace keeps facts about.
 *
 * Declaring creates nothing but identity. Fields arrive through the context
 * loop, each carrying the note line that taught it, because a record whose
 * fields could be set by hand with no evidence is a place for unsourced facts
 * to accumulate and later be quoted as though someone had established them.
 * Reading is where the value and its history are both visible, since "what
 * does it say" and "what changed it" are the same question asked twice.
 */
export function record(argv: string[]): number {
  const sub = argv[0];
  const { flags, rest } = parseFlags(argv.slice(1));
  const workspace = workspaceFlag(flags);

  if (sub === 'add') {
    const kind = (flags.kind ?? '').trim();
    const name = (flags.name ?? '').trim();
    if (kind === '' || name === '') {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const existing = findRecord(store, workspace, kind, name);
      if (existing) {
        // Not an error worth failing on, but not a silent second record
        // either: two records for one subject split its history in half, and
        // half a history reads exactly like a whole one.
        process.stderr.write(
          `record: ${workspace} already keeps ${kind} "${name}" as ${existing.id}\n`,
        );
        return 1;
      }
      const id = `rec-${at.replace(/[-:.TZ]/g, '')}`;
      addRecord(store, { id, workspace, kind, name, createdAt: at });
      process.stdout.write(
        `keeping ${id}: ${kind} "${name}" (workspace ${workspace}).\n` +
          '  Its fields fill in from notes — each one citing the line that taught it:\n' +
          '  construct notes <file|directory> --host=<opencode|claude|codex|cursor>\n',
      );
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = recordsFor(store, workspace);
      if (rows.length === 0) {
        process.stdout.write(`no records kept for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        const fields = currentFields(store, row.id);
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.name}  (${String(fields.length)} field${fields.length === 1 ? '' : 's'})\n`,
        );
      }
      return 0;
    });
  }

  if (sub === 'show') {
    const id = rest[0];
    if (!id) {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const subject = getRecord(store, id);
      if (!subject) {
        process.stderr.write(`record: no record ${id}\n`);
        return 1;
      }
      process.stdout.write(`${subject.id}: ${subject.kind} "${subject.name}" (since ${subject.createdAt})\n`);
      if (flags.field) {
        const history = fieldHistory(store, id, flags.field);
        if (history.length === 0) {
          process.stdout.write(`  ${flags.field}: never recorded\n`);
          return 0;
        }
        process.stdout.write(`\n${flags.field}, oldest first:\n`);
        for (const entry of history) {
          process.stdout.write(`  ${entry.recordedAt}  ${escapeForTerminal(entry.value)}\n    cites ${escapeForTerminal(entry.citation)}\n`);
        }
        return 0;
      }
      const fields = currentFields(store, id);
      if (fields.length === 0) {
        process.stdout.write('  no fields recorded yet\n');
        return 0;
      }
      for (const field of fields) {
        process.stdout.write(`  ${escapeForTerminal(field.field)}: ${escapeForTerminal(field.value)}\n    cites ${escapeForTerminal(field.citation)}\n`);
      }
      process.stdout.write('\n  How a field got here:  construct record show <id> --field=<name>\n');
      return 0;
    });
  }

  if (sub === 'erase' || sub === 'erase-note') {
    const id = rest[0];
    const reason = (flags.reason ?? '').trim();
    if (!id || reason === '') {
      process.stderr.write(RECORD_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      try {
        if (sub === 'erase-note') {
          const erased = eraseNote(store, id, reason, at);
          process.stdout.write(`erased note ${erased.subject}: its words are gone.\n`);
          process.stdout.write(
            '  Anything that cited a line of it no longer resolves, which is correct — a fact\n' +
              '  justified by words that no longer exist should not go on presenting itself as justified.\n',
          );
          return 0;
        }
        const { erased, notesStillNaming } = eraseRecord(store, id, reason, at);
        process.stdout.write(
          `erased record ${erased.subject}: the subject and ${String(erased.removed - 1)} field ` +
            `value${erased.removed - 1 === 1 ? '' : 's'}, including every earlier value.\n`,
        );
        // Never presented as complete when it is not. A note naming two
        // subjects is evidence about both, so taking it for one of them would
        // destroy the other's record with nobody having asked.
        if (notesStillNaming.length === 0) {
          process.stdout.write('  No note in this workspace still says that name.\n');
          return 0;
        }
        process.stdout.write(
          `\n${String(notesStillNaming.length)} note${notesStillNaming.length === 1 ? '' : 's'} ` +
            `still say${notesStillNaming.length === 1 ? 's' : ''} that name. The record is gone; ` +
            `${notesStillNaming.length === 1 ? 'this is' : 'these are'} not:\n`,
        );
        for (const note of notesStillNaming) {
          process.stdout.write(`  ${note.id}  (${note.recordedAt})\n`);
        }
        process.stdout.write(
          '\n  Read one before erasing it — a note naming someone else too is their evidence,\n' +
            '  and taking it for this subject removes theirs with nobody having asked:\n' +
            '  construct record erase-note <note-id> --reason=<why>\n',
        );
        return 0;
      } catch (error) {
        process.stderr.write(`record: ${(error as Error).message}\n`);
        return 1;
      }
    });
  }

  process.stderr.write(RECORD_USAGE);
  return 2;
}
