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
import { hostPullServe, roleServe, serve } from './serve.ts';
import { skills } from './skills.ts';
import { outcome } from './outcome.ts';
import { ask } from './ask.ts';
import { notes } from './notes.ts';
import { review } from './review.ts';
import { work } from './work.ts';
import { inbox, log, show } from './show.ts';
import { status } from './status.ts';
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
import { consent, mode, settings, trust } from './settings.ts';
import { standing } from './standing.ts';
import { resolveScheduleContext, schedule } from './schedule.ts';
import { staff } from './staff.ts';
import { completions } from './completions.ts';
import { wire } from './wire.ts';
import { init } from './init.ts';
import { daemon, daemonLiveHere } from './daemon.ts';
import { firstUnknownFlag, wantsHelp } from './flags.ts';

/**
 * The surface, re-exported. Tests and any other in-process caller reach a
 * command through this module rather than through the file it happens to live
 * in, so moving one between files is not a change to what Construct exposes.
 */
export { HOST_NAMES } from './runtime.ts';
export type { HostName } from './runtime.ts';
export { backup, cleanup, doctor, parseCleanupArgs } from './maintenance.ts';
export { hostPullServe, roleServe, serve } from './serve.ts';
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
export { status } from './status.ts';
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
export { consent, mode, settings, trust } from './settings.ts';
export { standing } from './standing.ts';
export { resolveScheduleContext, schedule, scheduleStatusLine } from './schedule.ts';
export { staff } from './staff.ts';
export { completions } from './completions.ts';
export { wire } from './wire.ts';
export { init } from './init.ts';
export { daemon } from './daemon.ts';

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
  'source', 'propose', 'audit', 'standing', 'schedule', 'record', 'mode', 'consent',
  'settings', 'trust', 'staff', 'skills', 'watch', 'reconcile', 'waive', 'revoke', 'verdict',
  'corpus', 'log', 'inbox', 'decide', 'lessons', 'serve', 'wire', 'init', 'doctor', 'backup',
  'cleanup', 'completions', 'daemon', 'status', 'version', 'help',
]);

/**
 * Dispatched to by the coordinator, never typed by a person, so it stays out
 * of the usage line while remaining a real verb the docs may name.
 */
export const INTERNAL_VERBS: readonly string[] = Object.freeze(['role-serve', 'host-pull-serve']);

/** The long flags a verb accepts, plus its one-line gloss — the material both
 * the grouped help and a single verb's `--help` are rendered from. The host
 * tuning quartet (`--host --model --binary --dir --timeout`) rides along on
 * every verb that can dispatch, so it is named once here and spread in. */
const HOST_FLAGS = ['host', 'model', 'binary', 'dir', 'timeout'] as const;

interface VerbHelp {
  readonly gloss: string;
  /** Long-flag names this verb accepts. Empty means it takes none. */
  readonly flags: readonly string[];
}

/**
 * Every verb's gloss and accepted flags, in one place. This is what a wrong
 * flag is checked against and what `construct <verb> --help` prints, so a verb
 * that grows a flag is described here or the flag is refused as unknown — the
 * same single-source discipline the dispatch table itself keeps.
 */
const HELP: Readonly<Record<string, VerbHelp>> = Object.freeze({
  outcome: { gloss: 'record what you want to happen and queue the work', flags: [...HOST_FLAGS, 'domains', 'workspace'] },
  ask: { gloss: 'ask the staff one question and read the answer here', flags: [...HOST_FLAGS, 'workspace', 'ceiling'] },
  work: {
    gloss: 'run a recorded outcome’s queued work',
    flags: [...HOST_FLAGS, 'run', 'all', 'concurrency', 'ceiling', 'lease-minutes', 'allow-distant-ground', 'voice'],
  },
  notes: { gloss: 'drop after-call notes in and reason over each', flags: [...HOST_FLAGS, 'workspace', 'run', 'max-notes'] },
  review: { gloss: 'review the workspace’s open drafts', flags: [...HOST_FLAGS, 'workspace', 'length'] },
  show: { gloss: 'show a run’s deliverables as a reader sees them', flags: ['run', 'record', 'json'] },
  status: { gloss: 'summarize where the workspace stands right now', flags: ['json'] },
  compose: { gloss: 'assemble a run’s work into one deliverable', flags: [...HOST_FLAGS, 'run', 'shape', 'record', 'no-close'] },
  plan: { gloss: 'show the plan a run will work from', flags: ['json'] },
  source: {
    gloss: 'declare and manage the ground a workspace reads',
    flags: ['kind', 'locator', 'as', 'authority', 'cap', 'emphasis', 'from', 'id', 'note', 'relevance', 'sensitive', 'not-sensitive', 'to', 'all', 'workspace', 'json'],
  },
  propose: {
    gloss: 'propose an outward change from a run',
    flags: [
      ...HOST_FLAGS, 'run', 'source', 'task', 'workspace', 'dry-run', 'action', 'as', 'because', 'document', 'from', 'kind', 'live', 'note', 'to',
      'was', 'was-file', 'at', 'at-file', 'now', 'now-file',
    ],
  },
  audit: { gloss: 'audit a repository’s enablement and file findings', flags: ['source', 'workspace', 'dry-run'] },
  standing: { gloss: 'set and fire standing outcomes on a schedule', flags: [...HOST_FLAGS, 'all', 'domains', 'due', 'every', 'workspace'] },
  schedule: { gloss: 'install the platform timer that fires what is due', flags: ['every', 'at', 'always-on', 'dry-run'] },
  record: { gloss: 'keep a workspace’s records of who it deals with', flags: ['kind', 'name', 'field', 'reason', 'workspace'] },
  mode: { gloss: 'show or set how a workspace engages', flags: ['workspace', 'set'] },
  consent: { gloss: 'show or set standing consent for low-risk changes', flags: ['workspace', 'set'] },
  settings: { gloss: 'show every setting and where it lives, or set one', flags: ['scope', 'workspace'] },
  trust: { gloss: 'trust or withdraw a project settings file', flags: ['ratify', 'revoke'] },
  staff: { gloss: 'list the staff, or the staff a run drew', flags: ['file', 'run'] },
  skills: { gloss: 'list, install, or remove the skills library', flags: [...HOST_FLAGS, 'all', 'force', 'out', 'uninstall'] },
  watch: { gloss: 'watch ground and fire an outcome on change', flags: [...HOST_FLAGS, 'all', 'due', 'every', 'root', 'source', 'workspace'] },
  reconcile: { gloss: 'reconcile the tracker against the repository', flags: ['absorb', 'live', 'tracker'] },
  waive: { gloss: 'waive a task’s challenge with a reason', flags: ['task', 'challenge', 'reason'] },
  revoke: { gloss: 'revoke a task’s authority with a reason', flags: ['task', 'reason'] },
  verdict: { gloss: 'say whether a run was right to surface what it did', flags: ['run', 'confirm', 'dismiss', 'missed', 'source'] },
  corpus: { gloss: 'export the verdict corpus', flags: [] },
  log: { gloss: 'read back what a run did, in whose name', flags: ['run', 'json'] },
  inbox: { gloss: 'hold the decisions that are genuinely yours', flags: ['json'] },
  decide: { gloss: 'record your call on a decision a run raised', flags: [...HOST_FLAGS, 'apply', 'approve', 'reject', 'pending', 'workspace'] },
  lessons: { gloss: 'list and admit held run-derived lessons', flags: ['workspace', 'json', 'admit', 'by', 'detail'] },
  serve: { gloss: 'put the spine inside your host over MCP, including in-session dispatch', flags: [] },
  wire: { gloss: 'wire the MCP entry into your host’s config', flags: ['yes'] },
  init: { gloss: 'confirm your host and see the spine, right after install', flags: ['yes'] },
  doctor: { gloss: 'report host presence and store health', flags: [] },
  backup: { gloss: 'copy the store into a directory outside it, checksum verified', flags: ['verify'] },
  cleanup: { gloss: 'remove a predecessor install', flags: ['dry-run', 'yes', 'all', 'keep-state', 'with-images', 'scope'] },
  completions: { gloss: 'emit a shell completion script', flags: ['shell'] },
  daemon: { gloss: 'run, inspect, and stop the opt-in resident sweeper', flags: ['every', 'foreground', 'idle-exit'] },
  version: { gloss: 'print the version and tuning stamp', flags: [] },
  help: { gloss: 'show this help', flags: [] },
});

/**
 * The grouped help surface, mirroring README's own task grouping. The first
 * groups are the spine's stages in order, so the mental model — say what you
 * want, run it, read it back, decide, judge — is legible from `construct help`
 * itself rather than only from the prose around it. Every verb in VERBS lives
 * in exactly one group; a verb added to the table and to no group here is
 * caught by the help-coverage test.
 */
const HELP_GROUPS: readonly (readonly [string, readonly string[]])[] = Object.freeze([
  ['Starting work', ['outcome', 'ask', 'standing', 'watch', 'schedule']],
  ['Running it', ['work', 'notes']],
  ['Reading back', ['status', 'show', 'log', 'plan', 'inbox', 'corpus']],
  ['Outward changes and decisions', ['propose', 'audit', 'decide', 'waive', 'revoke']],
  ['Ground', ['source', 'review']],
  ['Learning and governance', ['lessons', 'verdict', 'staff']],
  ['Workspace settings', ['mode', 'consent', 'record', 'settings', 'trust']],
  ['Composition and reconciliation', ['compose', 'reconcile']],
  ['Presence and hosts', ['serve', 'wire', 'init']],
  ['Maintenance', ['doctor', 'backup', 'cleanup', 'daemon', 'skills', 'completions', 'version', 'help']],
]);

/**
 * Verbs that print their own `--help` and validate their own flags. The
 * dispatcher steps aside for these rather than answering over them, so the
 * richer usage each already carries is the one a user sees. The free-text
 * verbs are here because a leading `--flag` on them is a per-verb judgment
 * (is it a flag, or part of the sentence?) that belongs in the verb.
 */
const SELF_HANDLED_HELP: ReadonlySet<string> = new Set(['outcome', 'ask', 'notes', 'completions', 'reconcile', 'watch']);

/**
 * Verbs the dispatcher does not fail-closed on for unknown flags: the free-text
 * verbs police their own leading flag (words are legitimate there), and
 * `settings` accepts arbitrary keys as file-layer overrides, so an unrecognized
 * one is data, not a typo.
 */
const OPEN_FLAGS: ReadonlySet<string> = new Set(['outcome', 'ask', 'notes', 'settings']);

/**
 * One verb's help: its gloss and the flags it takes.
 *
 * Deliberately not phrased as a `usage: construct <verb>` line. The surface
 * probe (scripts/lib/cli-surface.mjs) reads exactly that phrase to learn a
 * verb's subcommands from its own output, and a flags-only synopsis printed
 * over a subcommand-bearing verb would teach the probe the verb has no
 * subcommands. Leaving the phrase to the verb's own usage keeps the probe
 * reading behavior rather than this summary.
 */
export function verbHelp(verb: string): string {
  const spec = HELP[verb];
  if (!spec) return `construct ${verb}\n`;
  const flags = spec.flags.length > 0 ? `\n  flags: ${spec.flags.map((f) => `--${f}`).join('  ')}` : '';
  return `construct ${verb} — ${spec.gloss}${flags}\n  the whole surface: construct help\n`;
}

/** The whole help surface, grouped, with the spine named up front. */
export function groupedHelp(): string {
  const width = Math.max(...VERBS.map((v) => v.length));
  const lines: string[] = [
    'construct — one place to say what you want, run it, and read back the work.',
    '',
    'Start here: outcome → work → show → inbox → verdict',
    '  outcome records what you want, work runs it, show reads it back,',
    '  inbox holds what only you can decide, verdict says whether it was right.',
    '',
  ];
  for (const [title, verbs] of HELP_GROUPS) {
    lines.push(title);
    for (const verb of verbs) {
      lines.push(`  ${verb.padEnd(width)}  ${HELP[verb]?.gloss ?? ''}`);
    }
    lines.push('');
  }
  lines.push('One verb in depth: construct <verb> --help');
  return `${lines.join('\n')}\n`;
}

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

  // The whole surface, before any verb acts. `help`, and the two flag spellings
  // of it, answer the same question — which word runs which command — so they
  // answer it identically.
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(groupedHelp());
    return 0;
  }

  // `--help`/`-h` on a verb is answered here, before that verb reads its
  // arguments, so `construct outcome --help` prints usage and records nothing —
  // the alternative filed `--help` as the outcome text into an append-only log
  // nobody could edit back out. Verbs that carry their own richer usage are
  // left to print it; the rest are answered from the one table above.
  const rest = argv.slice(1);
  if (VERBS.includes(command)) {
    if (!SELF_HANDLED_HELP.has(command) && wantsHelp(rest)) {
      process.stdout.write(verbHelp(command));
      return 0;
    }
    // An unknown flag is a typo or a misremembered surface, never a silent
    // no-op: a verb that took `--drt-run` and did the wet run said nothing
    // about the difference. Free-text and settings police their own flags.
    if (!OPEN_FLAGS.has(command)) {
      const known = new Set(HELP[command]?.flags ?? []);
      const bad = firstUnknownFlag(rest, known);
      if (bad !== undefined) {
        process.stderr.write(`construct ${command}: unknown flag ${bad}\n${verbHelp(command)}`);
        return 2;
      }
    }
  }

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
    case 'status':
      return status(argv.slice(1));
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
    case 'schedule':
      return schedule(argv.slice(1), resolveScheduleContext(), await daemonLiveHere());
    case 'mode':
      return mode(argv.slice(1));
    case 'consent':
      return consent(argv.slice(1));
    case 'settings':
      return settings(argv.slice(1));
    case 'trust':
      return trust(argv.slice(1));
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
    case 'init':
      return init(argv.slice(1));
    case 'role-serve':
      return roleServe();
    case 'host-pull-serve':
      return hostPullServe();
    case 'revoke':
      return revoke(argv.slice(1));
    case 'doctor':
      return await doctor();
    case 'backup':
      return backup(argv.slice(1));
    case 'cleanup':
      return await cleanup(argv.slice(1));
    case 'completions':
      return completions(argv.slice(1));
    case 'daemon':
      return daemon(argv.slice(1));
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${packageVersion()}\n`);
      process.stdout.write(`${tuningStamp()}\n`);
      return 0;
    default:
      process.stdout.write(groupedHelp());
      return 1;
  }
}
