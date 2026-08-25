/**
 * cli/index.ts — the one CLI: the verb table and nothing else.
 *
 * Every command lives in its own module beside this one, and the kernel-grade
 * work each of them does lives behind the kernel seam. What stays here is the
 * part that is genuinely this file's: which word runs which command, the usage
 * line that names them all, and the two failures that belong to the process
 * rather than to any one verb — a reader that went away, and a store that
 * cannot be opened at all.
 *
 * Commands stay few; capability grows in packs and kernel libraries, not in
 * CLI surface.
 */

import { StoreUnavailableError } from '../kernel/store/open.ts';
import { tuningStamp } from '../hosts/tuning.ts';
import { packageVersion } from './runtime.ts';
import { backup, cleanup, doctor } from './maintenance.ts';
import { roleServe, serve } from './serve.ts';
import { skills } from './skills.ts';
import { outcome } from './outcome.ts';
import { ask } from './ask.ts';
import { notes } from './notes.ts';
import { review } from './review.ts';
import { work } from './work.ts';
import { inbox, log, show } from './show.ts';
import { lessons } from './lessons.ts';
import { decide } from './decide.ts';
import { corpus, verdict } from './verdict.ts';
import { watch } from './watch.ts';
import { reconcile } from './reconcile.ts';
import { revoke, waive } from './controls.ts';
import { source } from './source.ts';
import { record } from './record.ts';
import { compose } from './compose.ts';
import { plan } from './plan.ts';
import { audit, propose } from './propose.ts';
import { consent, mode, settings } from './settings.ts';
import { standing } from './standing.ts';
import { staff } from './staff.ts';
import { completions } from './completions.ts';
import { wire } from './wire.ts';

/**
 * The surface, re-exported. Tests and any other in-process caller reach a
 * command through this module rather than through the file it happens to live
 * in, so moving one between files is not a change to what Construct exposes.
 */
export { HOST_NAMES } from './runtime.ts';
export type { HostName } from './runtime.ts';
export { backup, cleanup, doctor, parseCleanupArgs } from './maintenance.ts';
export { roleServe, serve } from './serve.ts';
export { skills } from './skills.ts';
export { outcome, parseOutcomeArgs } from './outcome.ts';
export type { OutcomeArgs } from './outcome.ts';
export { ask, parseAskArgs } from './ask.ts';
export type { AskArgs } from './ask.ts';
export { DEFAULT_MAX_NOTES, notes, parseNotesArgs } from './notes.ts';
export type { NotesArgs } from './notes.ts';
export { parseReviewArgs, review } from './review.ts';
export type { ReviewArgs } from './review.ts';
export { DEFAULT_SPEND_CEILING, parseWorkArgs, work } from './work.ts';
export type { WorkArgs } from './work.ts';
export { inbox, log, reasonClause, show } from './show.ts';
export { lessons } from './lessons.ts';
export { decide } from './decide.ts';
export { corpus, corpusExport, parseVerdictArgs, verdict } from './verdict.ts';
export type { VerdictArgs } from './verdict.ts';
export { watch } from './watch.ts';
export { reconcile } from './reconcile.ts';
export { revoke, waive } from './controls.ts';
export { source } from './source.ts';
export { record } from './record.ts';
export { compose } from './compose.ts';
export { plan } from './plan.ts';
export { audit, propose } from './propose.ts';
export { consent, mode, settings } from './settings.ts';
export { standing } from './standing.ts';
export { staff } from './staff.ts';
export { completions } from './completions.ts';
export { wire } from './wire.ts';

/**
 * Every verb a user may type, and the one source that answers the question.
 *
 * The usage line below is built from this array rather than written beside it,
 * so a verb cannot exist in the dispatch table while the help text denies it.
 * Documentation is checked against the same array, which is what stops a guide
 * teaching a command the CLI has never accepted.
 */
export const VERBS: readonly string[] = Object.freeze([
  'outcome', 'ask', 'work', 'notes', 'review', 'show', 'compose', 'plan',
  'source', 'propose', 'audit', 'standing', 'record', 'mode', 'consent',
  'settings', 'staff', 'skills', 'watch', 'reconcile', 'waive', 'revoke', 'verdict',
  'corpus', 'log', 'inbox', 'decide', 'lessons', 'serve', 'wire', 'doctor', 'backup',
  'cleanup', 'completions', 'version', 'help',
]);

/**
 * Dispatched to by the coordinator, never typed by a person, so it stays out
 * of the usage line while remaining a real verb the docs may name.
 */
export const INTERNAL_VERBS: readonly string[] = Object.freeze(['role-serve']);

const USAGE = `usage: construct <${VERBS.join('|')}>\n`;

/**
 * Async because `work` dispatches to a host, and `outcome --host=…` may
 * consult one. The other commands stay synchronous — awaiting a number costs
 * nothing and keeps one entry point.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // `construct outcome … | head -1` closes the pipe while the command is still
  // writing, and an unhandled write to a closed stdout throws an 'error' event
  // that Node reports as a crash with a full stack. Piping into head, less, or
  // grep -m1 is ordinary use, and a stack trace on it reads as a broken tool.
  // A reader that has gone away is a normal end for a CLI, not a failure, so
  // the process stops quietly at that point rather than reporting one.
  const quitOnClosedOutput = (error: NodeJS.ErrnoException): void => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  };
  process.stdout.on('error', quitOnClosedOutput);
  process.stderr.on('error', quitOnClosedOutput);

  try {
    return await run(argv);
  } catch (error) {
    // Only this class. Every other throw keeps its stack, because a defect that
    // reads as a tidy one-liner is a defect nobody reports.
    if (!(error instanceof StoreUnavailableError)) throw error;
    process.stderr.write(`construct: ${error.message}\n`);
    return 1;
  }
}

async function run(argv: string[]): Promise<number> {
  const command = argv[0] ?? 'help';
  switch (command) {
    case 'review':
      return review(argv.slice(1));
    case 'record':
      return record(argv.slice(1));
    case 'compose':
      return compose(argv.slice(1));
    case 'notes':
      return notes(argv.slice(1));
    case 'outcome':
      return outcome(argv.slice(1));
    case 'ask':
      return ask(argv.slice(1));
    case 'work':
      return work(argv.slice(1));
    case 'watch':
      return watch(argv.slice(1));
    case 'reconcile':
      return reconcile(argv.slice(1));
    case 'waive':
      return waive(argv.slice(1));
    case 'verdict':
      return verdict(argv.slice(1));
    case 'corpus':
      return corpus(argv.slice(1));
    case 'log':
      return log(argv.slice(1));
    case 'show':
      return show(argv.slice(1));
    case 'plan':
      return plan(argv.slice(1));
    case 'source':
      return source(argv.slice(1));
    case 'propose':
      return propose(argv.slice(1));
    case 'audit':
      return audit(argv.slice(1));
    case 'standing':
      return standing(argv.slice(1));
    case 'mode':
      return mode(argv.slice(1));
    case 'consent':
      return consent(argv.slice(1));
    case 'settings':
      return settings(argv.slice(1));
    case 'staff':
      return staff(argv.slice(1));
    case 'skills':
      return skills(argv.slice(1));
    case 'inbox':
      return inbox(argv.slice(1));
    case 'decide':
      return decide(argv.slice(1));
    case 'lessons':
      return lessons(argv.slice(1));
    case 'serve':
      return serve();
    case 'wire':
      return wire(argv.slice(1));
    case 'role-serve':
      return roleServe();
    case 'revoke':
      return revoke(argv.slice(1));
    case 'doctor':
      return doctor();
    case 'backup':
      return backup(argv.slice(1));
    case 'cleanup':
      return cleanup(argv.slice(1));
    case 'completions':
      return completions(argv.slice(1));
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${packageVersion()}\n`);
      process.stdout.write(`${tuningStamp()}\n`);
      return 0;
    default:
      process.stdout.write(USAGE);
      return command === 'help' ? 0 : 1;
  }
}
