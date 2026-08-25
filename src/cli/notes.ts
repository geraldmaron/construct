/**
 * cli/notes.ts — dropping after-call notes in, and running the context loop
 * over each of them.
 *
 * A file is one note. A directory is every document under it, each recorded as
 * its own note and reasoned over separately. Evidence lands before any model is
 * consulted, and one document that cannot be read never ends the batch. The
 * loop itself is kernel work (kernel/context/note-loop.ts); what lives here is
 * the walk, the recording, the bound on how much will be reasoned over, and
 * the host calls handed to it.
 */

import { statSync } from 'node:fs';
import { recordNote } from '../kernel/store/notes.ts';
import { sourcesFor } from '../kernel/store/sources.ts';
import { appendWorkLog } from '../kernel/store/worklog.ts';
import { runNoteLoop } from '../kernel/context/note-loop.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { listDocuments } from '../hosts/sources.ts';
import { probeDocling, readSource } from '../hosts/extract.ts';
import { createHostChallenger, createHostProducer } from '../hosts/contextloop.ts';
import { createHostDensifier } from '../hosts/densifier.ts';
import { adapterForHost, now, terminalReport, withStoreAsync } from './runtime.ts';
import type { HostName } from './runtime.ts';
import { firstUnknownFlag, parseHostFlags, splitFlags, wantsHelp } from './flags.ts';
import { driftGround, surveyDeclared } from './survey.ts';
import { writeDrift } from './present.ts';

const NOTES_USAGE =
  'usage: construct notes <file|directory> [--workspace=<name>] [--run=<id>] [--max-notes=<n>] ' +
  '[--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]]\n';

/**
 * How many notes one invocation will reason over before stopping.
 *
 * There is no money ceiling here and stating a fake one would be worse than
 * stating none: the spend ceiling `ask` and `work` enforce sums the tasks
 * table, and the context loop creates no tasks, so a `--ceiling` on this
 * command would read a number it never moves. What binds regardless of what
 * any host reports about cost is the count, so the count is what is bounded.
 *
 * Twenty-five because a person dropping a quarter's call notes should not have
 * to think about this, and someone pointing at a documents repository of two
 * thousand files should be stopped before the first dispatch rather than
 * after the six hundredth.
 */
export const DEFAULT_MAX_NOTES = 25;

/** Model calls one note costs: densify, produce, and one challenge per delta. */
const CALLS_PER_NOTE = 3;

export interface NotesArgs {
  readonly file: string;
  readonly workspace: string;
  readonly run?: string;
  /** How many notes this invocation will reason over before stopping. */
  readonly maxNotes: number;
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

export function parseNotesArgs(argv: string[]): NotesArgs {
  const unknown = firstUnknownFlag(
    argv,
    new Set(['host', 'model', 'binary', 'dir', 'timeout', 'workspace', 'run', 'max-notes']),
  );
  if (unknown !== undefined) throw new Error(`unknown flag ${unknown}`);
  const { flags, words } = splitFlags(argv);
  if (words.length !== 1) {
    throw new Error(words.length === 0 ? 'a notes path is required' : 'one notes path at a time');
  }
  const maxNotes = flags['max-notes'] === undefined ? DEFAULT_MAX_NOTES : Number(flags['max-notes']);
  if (!Number.isInteger(maxNotes) || maxNotes < 1) {
    throw new Error(`--max-notes must be a positive whole number, got "${flags['max-notes'] ?? ''}"`);
  }
  return {
    file: words[0] as string,
    workspace: flags.workspace ?? 'default',
    run: flags.run,
    maxNotes,
    ...parseHostFlags(flags),
  };
}

/**
 * Drop after-call notes and, with a host named, run the context loop over
 * each of them.
 *
 * A file is one note. A directory is every document under it, each recorded
 * as its own note and reasoned over separately — a pile of call transcripts
 * is the shape this arrives in, and one shell invocation per file was the
 * shape it was previously ingested in.
 *
 * Evidence lands before any model is consulted, and one document that cannot
 * be read never ends the batch: the documents that could be read are evidence
 * whatever happened to the ones that could not. Without --host, recording is
 * all that happens — the loop is model work, and the free path says so
 * instead of guessing.
 */
export async function notes(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  if (wantsHelp(argv)) {
    process.stdout.write(NOTES_USAGE);
    return 0;
  }
  let args: NotesArgs;
  try {
    args = parseNotesArgs(argv);
  } catch (error) {
    process.stderr.write(`notes: ${(error as Error).message}\n${NOTES_USAGE}`);
    return 2;
  }

  // One walk resolves the argument into the documents to ingest. A directory
  // is walked exactly as a declared source is surveyed — same skip rules, same
  // ordering — because ground that can be surveyed and ground that can be
  // ingested must be the same ground.
  let documents: string[];
  try {
    documents = statSync(args.file).isDirectory()
      ? listDocuments(args.file).documents.map((d) => d.path)
      : [args.file];
  } catch (error) {
    process.stderr.write(`notes: cannot read ${args.file} — ${(error as Error).message}\n`);
    return 1;
  }
  if (documents.length === 0) {
    process.stderr.write(`notes: ${args.file} holds no documents this install can read.\n`);
    return 1;
  }
  if (documents.length > 1) {
    process.stdout.write(
      `ingesting ${String(documents.length)} documents from ${args.file}, each as its own note.\n`,
    );
  }

  // Probed once for the batch: the probe spawns a process, and one spawn per
  // document is the difference between an ingest and a stall.
  const doclingProbe = probeDocling();

  return withStoreAsync(async (store) => {
    const recorded: Array<{ readonly noteId: string; readonly body: string }> = [];
    let refused = 0;
    for (const document of documents) {
      // Reading goes through the extraction ladder, not a bare byte read: a
      // binary document either extracts through a rung this install can run,
      // or is refused with the ladder's own remediation — garbage bytes
      // recorded as prose is the failure mode this replaces.
      const sourceRead = readSource(document, { docling: doclingProbe });
      if (!sourceRead.ok) {
        refused += 1;
        process.stderr.write(
          `notes: ${escapeForTerminal(sourceRead.reason)}\n` +
            (sourceRead.remediation ? `  ${escapeForTerminal(sourceRead.remediation)}\n` : '') +
            `  (docling probe: ${escapeForTerminal(doclingProbe.detail)})\n`,
        );
        // The refusal and its fallback path reach the record, not just
        // stderr — a run reading its log later must see why this source is
        // absent. One refusal never ends the batch: the documents that could
        // be read are evidence whatever happened to the ones that could not.
        if (args.run) {
          appendWorkLog(store, {
            run: args.run,
            role: 'intake',
            action: 'extraction-refused',
            detail: {
              file: document,
              reason: sourceRead.reason,
              remediation: sourceRead.remediation,
              doclingProbe: doclingProbe.detail,
            },
            at: now(),
          });
        }
        continue;
      }
      const body = sourceRead.text;
      const at = now();
      const noteId = `note-${at.replace(/[-:.TZ]/g, '')}-${String(recorded.length + 1)}`;
      try {
        recordNote(store, {
          id: noteId,
          workspace: args.workspace,
          run: args.run ?? null,
          door: 'file-drop',
          body,
          recordedAt: at,
        });
      } catch (error) {
        refused += 1;
        process.stderr.write(`notes: ${(error as Error).message}\n`);
        continue;
      }
      const lineCount = body.split('\n').length;
      process.stdout.write(
        `note ${noteId}: ${lineCount} line${lineCount === 1 ? '' : 's'} recorded verbatim in workspace "${args.workspace}".\n`,
      );
      recorded.push({ noteId, body });
    }

    if (recorded.length === 0) return 1;
    if (refused > 0) {
      process.stdout.write(
        `\n${String(refused)} document${refused === 1 ? '' : 's'} could not be read and ${refused === 1 ? 'is' : 'are'} not recorded; ` +
          `${String(recorded.length)} landed.\n`,
      );
    }

    if (args.host === undefined && hostOverride === undefined) {
      process.stdout.write(
        `\nThe ${recorded.length === 1 ? 'note is' : 'notes are'} kept; drawing conclusions from ` +
          `${recorded.length === 1 ? 'it' : 'them'} is model work, at cost:\n` +
          `  construct notes --host=<opencode|claude|codex|cursor> ${args.file}\n`,
      );
      return 0;
    }

    // What the loop is about to spend, before it spends it. The count is the
    // only bound that holds: no money ceiling binds here, and one that reads a
    // number this command never moves would be a bound in name only.
    const reasoning = recorded.slice(0, args.maxNotes);
    const deferred = recorded.length - reasoning.length;
    if (recorded.length > 1) {
      process.stdout.write(
        `\nreasoning over ${String(reasoning.length)} note${reasoning.length === 1 ? '' : 's'}: ` +
          `at least ${String(reasoning.length * CALLS_PER_NOTE)} model calls, one host invocation each.\n`,
      );
    }
    if (deferred > 0) {
      process.stdout.write(
        `  ${String(deferred)} more ${deferred === 1 ? 'note is' : 'notes are'} recorded and left unreasoned ` +
          `(--max-notes=${String(args.maxNotes)}). They keep their rows; raise the limit to take them:\n` +
          `  construct notes ${args.file} --max-notes=${String(recorded.length)} --host=${args.host ?? '<host>'}\n`,
      );
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, { binary: args.binary, model: args.model, dir: args.dir, timeoutMs: args.timeoutMs });
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(
        `notes: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}. ` +
          `The ${recorded.length === 1 ? 'note is' : 'notes are'} recorded; run the loop again when the host is.\n`,
      );
      return 1;
    }

    // The declared ground, actually walked, before the model is asked what
    // disagrees in it. A producer shown locators alone answers about documents
    // it remembers, and the screen downstream has no listing to catch that
    // with — so the survey is what turns the drift pass into an observation.
    // Surveyed once for the batch: it is the same ground for every note.
    const sources = sourcesFor(store, args.workspace);
    const { producerSources, surveyed, words } = driftGround(sources, surveyDeclared(store, sources));

    const calls = {
      densify: createHostDensifier(host),
      produce: createHostProducer(host),
      challenge: createHostChallenger(host),
    };

    let failed = 0;
    for (const { noteId, body } of reasoning) {
      if (reasoning.length > 1) process.stdout.write(`\n── ${noteId} ──\n`);
      const outcome = await runNoteLoop(store, calls, {
        noteId,
        body,
        workspace: args.workspace,
        run: args.run,
        at: now(),
        sources,
        producerSources,
        surveyed,
        words,
        report: terminalReport,
      });
      if (outcome.ran) writeDrift(outcome.drift);
      else failed += 1;
    }
    // Every note that could not be reasoned over is still recorded evidence,
    // so a batch where some loops failed is a partial success, not a failure.
    return failed === reasoning.length ? 1 : 0;
  });
}
