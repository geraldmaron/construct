/**
 * cli/work.ts — dispatching a run's queued tasks to a host.
 *
 * Everything expensive happens here, so everything this file prints is about
 * what was spent and what came back: the grounding pass before the first call,
 * the measured floor a small model is about to miss, the per-task cost, the
 * concerns under each deliverable, and the recourse when nothing came back at
 * all. `hostOverride` exists so the wiring can be tested without a binary
 * present; production callers never pass it.
 */

import { resolve } from 'node:path';
import { readRunDispatch } from '../kernel/store/dispatch.ts';
import { countTasksByState, getTask, listTasks } from '../kernel/store/tasks.ts';
import { appendWorkLog } from '../kernel/store/worklog.ts';
import { DEFAULT_CONCURRENCY, frameConflicts, workRun } from '../kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor } from '../kernel/run/accountability.ts';
import { latestDraft } from '../kernel/run/promotion.ts';
import { renderClaim } from '../kernel/run/publish.ts';
import { citedAuthorityFor } from '../kernel/run/sourcereads.ts';
import { groundingSummary, groundRun } from '../kernel/run/groundpass.ts';
import { groundRootsFor } from '../kernel/run/sourcereads.ts';
import { groundReach, unreachableGroundMessage } from '../kernel/run/reachability.ts';
import { synthesizeIssues } from '../kernel/run/synthesis.ts';
import { loadOrCreateSecret } from '../kernel/capabilities/secretfile.ts';
import { resolvedLocale } from './locale.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import {
  chooseResource,
  explainSelection,
  HOST_SELECTION_ACTION,
  needFor,
  selectionDetail,
} from '../kernel/hosts/selection.ts';
import type { Selection, WorkNeed } from '../kernel/hosts/selection.ts';
import { readReachableSkills } from './skills.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { architectureNoteFor } from '../hosts/architecture.ts';
import { dispatchShapeNoteFor } from '../hosts/dispatchshape.ts';
import { dispatchFloorFor } from '../hosts/floors.ts';
import { surveyResources } from '../hosts/census.ts';
import type { ProbeExec } from '../hosts/presence.ts';
import { readRepoManifest } from '../hosts/repo/gates.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { adapterForHost, HOST_NAMES, now, secretFile, withStoreAsync } from './runtime.ts';
import { runFlag, timeoutFlag } from './flags.ts';
import { surveyor } from './survey.ts';
import { failureLine, money, writeTotalFailureRecourse } from './present.ts';

/**
 * The flag that dispatches anyway when ground sits outside the working
 * directory. Named once so the refusal, the override and the log entry cannot
 * drift into naming three different things.
 */
const UNREACHABLE_GROUND_FLAG = '--allow-distant-ground';

export interface WorkArgs {
  readonly run?: string;
  readonly concurrency: number;
  readonly ceiling: number;
  readonly leaseMinutes: number;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /**
   * Dispatch even where a licensed ground root sits outside the directory the
   * roles will run in. Off by default: the roles would be graded on material
   * they cannot open. On when the operator knows this host reaches wider than
   * its working directory, which Construct cannot see from here.
   */
  readonly allowDistantGround: boolean;
  /**
   * Explicit opt-in to dispatch every pending task across every run, when no
   * single run was named. A fleet dispatch is real spend, so it is never what
   * an argument-free invocation does on the reader's behalf — this flag is the
   * only other door into that behavior besides naming the run directly.
   */
  readonly all: boolean;
  /** Which host executes: 'opencode' (default) or 'claude'. */
  readonly host: string;
  /**
   * Whether --host was actually typed. The default and the recorded choice
   * must be distinguishable, or the recorded choice could never win.
   */
  readonly hostExplicit: boolean;
  /**
   * The ambient host this process was detected running inside, when --host
   * was not typed. Carried separately from `host` so a caller can tell "the
   * default resolved to opencode because nothing was detected" apart from
   * "the default resolved to opencode because that is what was ambiently
   * detected" — the two print different things.
   */
  readonly ambientHost?: string;
  /** The env var that matched, for `ambientHost` to be explained rather than asserted. */
  readonly ambientMarker?: string;
  /** Whether `ambientHost` has a wired dispatch adapter (false: detected but projection-only). */
  readonly ambientWired: boolean;
  /**
   * The user asking for a voice other than Construct's, in their own words.
   * Absent is the house voice — the case that needs no flag and no record.
   */
  readonly voice?: string;
  /**
   * How long one host invocation may run, in milliseconds. Host default when
   * unset. A grounded dispatch over a real repository on a small local model
   * was measured producing nothing inside the ten-minute default, so the limit
   * is the caller's to set rather than one constant for every model.
   */
  readonly timeoutMs?: number;
}

/**
 * The ceiling is total spend across every run this machine has recorded, not
 * this invocation's — ten runs of nine dollars is exactly what a per-run cap
 * misses. It is deliberately low enough to be hit, since a ceiling nobody ever
 * reaches has never been tested.
 */
export const DEFAULT_SPEND_CEILING = 10;

/**
 * The flags that are true by being present. Only these parse bare: the
 * unreachable-ground refusal shows its remedy bare, so the bare form is the
 * documented form and dropping it would refuse a user for typing exactly what
 * the message told them to. A value flag typed bare stays dropped here and
 * surfaces through its own validation, because mapping it to an empty string
 * would turn a typo into a silent default (a bare --concurrency would read as
 * zero and dispatch nothing).
 */
const BOOLEAN_FLAGS = ['allow-distant-ground', 'all'] as const;

/**
 * Printed on a bare `construct work` (or one that names neither a run nor
 * the fleet opt-in) once there is real work it would otherwise have spent
 * money dispatching. Every other verb prints usage on a bare invocation;
 * `work` is the one that would have spent instead, so the usage line here
 * also states the choice rather than only the syntax.
 */
const WORK_USAGE =
  'usage: construct work --run=<id> [options]\n' +
  '   or: construct work --all [options]   dispatch every pending task across every run\n' +
  'construct work with neither --run nor --all does nothing: dispatching every queued\n' +
  'task is real spend, and it is never the no-argument default.\n';

export function parseWorkArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): WorkArgs {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
    else if ((BOOLEAN_FLAGS as readonly string[]).includes(arg.slice(2))) args[arg.slice(2)] = 'true';
  }
  const run = runFlag(argv);

  const number = (name: string, fallback: number): number => {
    if (args[name] === undefined) return fallback;
    const value = Number(args[name]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid --${name}=${args[name]}; expected a non-negative number`);
    }
    return value;
  };

  // The fallback, when nothing was typed: the session Construct is already
  // running inside, when that session has a wired adapter — never a host the
  // user is not in — and only then 'opencode', the last resort this project
  // shipped with before ambient detection existed. A typed --host always wins
  // outright; this is only what fills the silence.
  const ambient = args.host === undefined ? detectAmbientHost(env) : null;
  const ambientDefault =
    ambient !== null && (HOST_NAMES as readonly string[]).includes(ambient.host) ? ambient.host : undefined;
  const host = args.host ?? ambientDefault ?? 'opencode';
  if (!(HOST_NAMES as readonly string[]).includes(host)) {
    throw new Error(`Invalid --host=${host}; expected ${HOST_NAMES.join('|')}`);
  }

  const leaseMinutes = number('lease-minutes', 15);
  const timeoutMs = timeoutFlag(args);
  // The lease exceeds the invocation limit by design: a task whose lease
  // expires while the host is still working it is handed to a second worker,
  // and the same work is then paid for twice. Raising the limit past the lease
  // silently would arrange exactly that, so it is refused with the other flag
  // named rather than accepted and warned about.
  if (timeoutMs !== undefined && timeoutMs >= leaseMinutes * 60 * 1000) {
    throw new Error(
      `--timeout=${args.timeout} exceeds --lease-minutes=${String(leaseMinutes)}; a task still running ` +
        'when its lease expires is dispatched again and paid for twice. Raise --lease-minutes past the timeout.',
    );
  }

  return {
    run,
    concurrency: number('concurrency', DEFAULT_CONCURRENCY),
    ceiling: number('ceiling', DEFAULT_SPEND_CEILING),
    leaseMinutes,
    model: args.model,
    binary: args.binary,
    dir: args.dir,
    allowDistantGround: args['allow-distant-ground'] === 'true' || args['allow-distant-ground'] === '',
    all: args.all === 'true' || args.all === '',
    host,
    hostExplicit: args.host !== undefined,
    ambientHost: ambient?.host,
    ambientMarker: ambient?.marker,
    ambientWired: ambientDefault !== undefined,
    voice: args.voice?.trim() ? args.voice.trim() : undefined,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Whether this invocation gets to choose its own host. A named host is the
 * answer, a host recorded at the moment the run was filed is the answer, and a
 * binary path names a host implicitly because a path to one host's executable
 * means nothing to another. Selection is for what is left: the user said
 * nothing about where this should run.
 */
function selectionIsOurs(input: {
  readonly hostExplicit: boolean;
  readonly recordedHost: string | null;
  readonly binary: string | undefined;
  readonly overridden: boolean;
  /**
   * Whether this process is ambiently running inside a host that has a wired
   * adapter. Treated like `hostExplicit`: a user physically in a session has
   * already answered the question a cost-optimizing census would otherwise
   * ask on their behalf, and the answer is "run it here" — the incident this
   * carries a fix for was exactly the opposite of that being honored.
   */
  readonly ambientWired: boolean;
}): boolean {
  if (input.overridden) return false;
  if (input.hostExplicit) return false;
  if (input.recordedHost !== null) return false;
  if (input.binary !== undefined) return false;
  if (input.ambientWired) return false;
  return true;
}

/**
 * Dispatch the queued tasks to a host. `hostOverride` exists so the CLI's own
 * wiring can be tested without a binary present; production callers never pass
 * it, exactly as with cleanup's spawn override. `probe` is the same seam one
 * level down: it puts the resource census in front of a scripted machine
 * rather than this one. An override on its own means the adapter is settled
 * and there is nothing to choose; an override with a probe means the choice is
 * what is under test and the override is only what carries out the dispatch
 * afterwards.
 */
export async function work(
  argv: string[],
  hostOverride?: HostAdapter,
  probe?: ProbeExec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let args: WorkArgs;
  try {
    args = parseWorkArgs(argv, env);
  } catch (error) {
    process.stderr.write(`work: ${(error as Error).message}\n`);
    return 2;
  }

  return withStoreAsync(async (store) => {
    // The run remembers the surface it was filed with; a flag typed now still
    // wins, and the divergence goes on the record rather than passing silently.
    const recorded = args.run ? readRunDispatch(store, args.run) : null;
    const hostName = args.hostExplicit ? args.host : (recorded?.host ?? args.host);
    const model = args.model ?? recorded?.model ?? undefined;
    const binary = args.binary ?? recorded?.binary ?? undefined;
    const dir = args.dir ?? recorded?.dir ?? undefined;

    if (recorded && args.run) {
      const overrides: string[] = [];
      if (args.hostExplicit && args.host !== recorded.host) {
        overrides.push(`host ${recorded.host} -> ${args.host}`);
      }
      if (args.model !== undefined && recorded.model !== null && args.model !== recorded.model) {
        overrides.push(`model ${recorded.model} -> ${args.model}`);
      }
      if (overrides.length > 0) {
        appendWorkLog(store, {
          run: args.run,
          task: null,
          role: 'construct',
          action: 'dispatch-overridden',
          detail: { overrides, recordedAt: recorded.recordedAt },
          at: now(),
        });
      }
    }

    const waiting = countTasksByState(store, args.run).pending ?? 0;
    if (waiting === 0) {
      // Nothing to dispatch is not the same as nothing to do. If a previous
      // invocation settled this run's tasks and then died before framing —
      // a SIGTERM, an OOM, a closed laptop, and the window is the whole run —
      // the decision those deliverables imply has never been raised, and this
      // guard used to return before anything could reach it.
      // Framing needs no host and no spend, so it runs before the guard reports.
      const raised = frameConflicts(store, [], { clock: now, run: args.run });

      const counts = countTasksByState(store, args.run);
      const done = counts.done ?? 0;
      const failedTasks = counts.failed ?? 0;

      if (done === 0 && failedTasks === 0) {
        process.stdout.write(
          'nothing to work. Record an outcome first: construct outcome "<what you want>"\n',
        );
        return 0;
      }

      // A run where every task failed is not a run that finished, and saying
      // "already settled" in the same words used for a successful one leaves the
      // user with a dead run id and no stated path. The store is
      // right that a failed task is terminal and that the host owns retries
      // (commitment 1) — nothing here adds a retry policy. What was missing is
      // that two different things were being reported identically: the task a
      // host genuinely could not do, and the task that never reached a working
      // host at all. The recorded error is what tells them apart, so it is shown.
      if (done === 0) {
        const where = args.run ? ` for ${args.run}` : '';
        process.stdout.write(`nothing to work${where}.\n`);
        for (const task of listTasks(store, args.run).filter((t) => t.state === 'failed')) {
          process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${escapeForTerminal(failureLine(task.error))}\n`);
        }
        writeTotalFailureRecourse(failedTasks);
        return 1;
      }

      process.stdout.write(
        args.run
          ? `nothing to work for ${args.run}. Its tasks are already settled.\n`
          : 'nothing to work. Every task in the store is already settled.\n',
      );
      if (failedTasks > 0) {
        process.stdout.write(
          `${String(failedTasks)} of ${String(done + failedTasks)} task(s) failed; ` +
            'their roles produced no deliverable.\n',
        );
      }
      if (raised > 0) {
        process.stdout.write(
          `\n${String(raised)} decision(s) need you — the roles disagree.\n` + 'See: construct inbox\n',
        );
      }
      return 0;
    }

    // Real pending work exists and no run was named: this is the fleet
    // dispatch the bare invocation must never fall into on its own. A typed
    // --run scopes the spend to one run; --all is the only other door, and it
    // has to be typed too. Checked here, after the nothing-to-work guard
    // above and before the census or any host is touched, so a bare
    // `construct work` against a store with real work queued spends nothing
    // and calls no host.
    if (!args.run && !args.all) {
      process.stderr.write(WORK_USAGE);
      return 2;
    }

    const pending = listTasks(store, args.run).filter((t) => t.state === 'pending');
    const pendingRuns = new Set(pending.map((t) => t.run));

    // Choosing where this runs, when the user did not. The census is probed
    // only on this path and only past the nothing-to-do guard above, so a
    // command with nothing to dispatch never spawns a host binary to find out
    // what it could have dispatched to.
    let selected = hostName;
    if (
      selectionIsOurs({
        hostExplicit: args.hostExplicit,
        recordedHost: recorded?.host ?? null,
        binary,
        overridden: hostOverride !== undefined && probe === undefined,
        ambientWired: args.ambientWired,
      })
    ) {
      const need: WorkNeed = needFor(pending.map((t) => t.brief));
      const selection: Selection = chooseResource(surveyResources(probe, model), need);
      const stream = selection.rung === 'refused' ? process.stderr : process.stdout;
      const prefix = selection.rung === 'refused' ? 'work: ' : '';
      for (const [index, line] of explainSelection(selection, need).entries()) {
        stream.write(`${index === 0 ? prefix : ''}${escapeForTerminal(line)}\n`);
      }
      // Recorded against every run this invocation is about to work, so
      // reading one run's log shows what carried it and what did not, the same
      // way the licensed ladder records which rung answered each read and write.
      for (const runId of pendingRuns) {
        appendWorkLog(store, {
          run: runId,
          task: null,
          role: 'construct',
          action: HOST_SELECTION_ACTION,
          detail: selectionDetail(selection, need),
          at: now(),
        });
      }
      if (selection.host === null) {
        // Reaching here means ambient detection either found nothing or found
        // a host with no wired adapter (selectionIsOurs already sent a wired
        // ambient host straight to dispatch, never through this refusal) — so
        // the hint says which of those two it was, rather than only listing
        // the hosts a census found unusable.
        if (args.ambientHost !== undefined) {
          process.stderr.write(
            `  Running inside ${args.ambientHost} (detected via ${args.ambientMarker}), which has no ` +
              'wired dispatch adapter — presence only, not execution.\n',
          );
        }
        process.stderr.write(
          `  Name one yourself to dispatch anyway: construct work --host=<${HOST_NAMES.join('|')}>\n`,
        );
        return 1;
      }
      selected = selection.host;
    }

    const host =
      hostOverride ?? adapterForHost(selected, { binary, model, dir, timeoutMs: args.timeoutMs });

    // Where the roles will actually run: the host's --dir when given, and
    // otherwise wherever this process was invoked, which is what every adapter
    // inherits when nothing is passed.
    const dispatchDirectory = resolve(args.dir ?? process.cwd());

    // The producer half of grounding, run before any dispatch: what each run's
    // declared sources actually hold is surveyed and recorded, so materialFor
    // answers the coordinator from evidence rather than from silence. Once per
    // run, because the record is evidence rather than a cache, and a run whose
    // plan declared no sources is left exactly as it was.
    for (const runId of pendingRuns) {
      const pass = groundRun(store, runId, now(), surveyor(store));
      if (!pass || pass.skipped) continue;
      const documents = pass.documents;
      process.stdout.write(`grounded ${runId}: ${groundingSummary(pass)}\n`);

      // Licensing ground the dispatch cannot open is how a run comes back
      // three-tasks-done with every file read failed and every deliverable
      // ungrounded. Knowable here, before a model call is paid for.
      //
      // A declared locator is stored exactly as typed, and a directory source
      // is routinely typed relative to wherever `source add` was run. Compared
      // to dispatchDirectory (already made absolute above) without resolving
      // first, a relative root can never match even the directory it actually
      // names — so the refusal's own suggested fix, typed back verbatim,
      // reproduced the identical refusal. Resolving both sides against the
      // same cwd before comparing is what makes --dir=<the named root> the
      // remedy it is printed as, rather than a second dead end.
      const roots = groundRootsFor(store, runId).map((root) => resolve(root));
      const reach = groundReach(roots, dispatchDirectory);
      const unreachable = unreachableGroundMessage(reach, dispatchDirectory, UNREACHABLE_GROUND_FLAG);
      if (unreachable && !args.allowDistantGround) {
        process.stderr.write(`work: ${unreachable}`);
        appendWorkLog(store, {
          run: runId,
          role: 'construct',
          action: 'ground-unreachable',
          detail: { from: dispatchDirectory, unreachable: reach.unreachable, reachable: reach.reachable },
          at: now(),
        });
        return 1;
      }
      if (unreachable) {
        // Overridden, not absent: the operator said this host reaches past its
        // working directory, and the record must show that was a choice.
        process.stdout.write(`  ⚑ ${UNREACHABLE_GROUND_FLAG}: ${String(reach.unreachable.length)} root(s) outside ${dispatchDirectory}\n`);
        appendWorkLog(store, {
          run: runId,
          role: 'construct',
          action: 'ground-unreachable-allowed',
          detail: { from: dispatchDirectory, unreachable: reach.unreachable },
          at: now(),
        });
      }

      // Where a measured floor is met before it is paid for, rather than ten
      // minutes per role later. It is stated as the nearest recorded
      // observation and names the model it was measured on, because a
      // measurement on a neighbouring model is not a prediction about this
      // one — and both ways out are named, since a caution with no next move
      // is just a slower failure.
      const floor = dispatchFloorFor(host.model ?? model, documents);
      if (floor) {
        const limit = host.invocationTimeoutMs ?? floor.timeoutMs;
        process.stdout.write(
          `  ⚑ nearest recorded observation (${floor.observedOn}, ${floor.measuredOn}): ${floor.observation}.\n` +
            `    This dispatch has ${String(documents)} document${documents === 1 ? '' : 's'} and ` +
            `${String(Math.round(limit / 60000))} minute(s) per role.\n` +
            '    Give it longer:  construct work --timeout=<minutes> --lease-minutes=<more>\n' +
            '    Or give it less ground:  construct source add --workspace=<name> …  then ' +
            'construct outcome --workspace=<name> …\n' +
            `    Evidence: ${floor.evidence}\n`,
        );
      }

      // Same discipline as the floor above: named model, dated run, evidence
      // path — never a claim that this dispatch's model will behave like the
      // one measured, only the nearest recorded observation.
      const architectureNote = architectureNoteFor(host.model ?? model);
      if (architectureNote) {
        process.stdout.write(
          `  ⚑ architecture note (${architectureNote.observedOn}, ${architectureNote.measuredOn}): ` +
            `${architectureNote.observation}.\n` +
            `    Evidence: ${architectureNote.evidence}\n`,
        );
      }

      // Same discipline again, one fact narrower still: not whether the model
      // finishes or which architecture it favours, but whether its
      // deliverables actually land in the template they were given.
      const dispatchShapeNote = dispatchShapeNoteFor(host.model ?? model);
      if (dispatchShapeNote) {
        process.stdout.write(
          `  ⚑ dispatch-shape note (${dispatchShapeNote.observedOn}, ${dispatchShapeNote.measuredOn}): ` +
            `${dispatchShapeNote.observation}.\n` +
            `    Evidence: ${dispatchShapeNote.evidence}\n`,
        );
      }
    }

    try {
      await host.init();
    } catch (error) {
      // A host that cannot start must never read as a run with nothing to do.
      process.stderr.write(`work: host "${host.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }

    if (args.voice) {
      // Said out loud, not only written down: an deliverable that will not sound
      // like Construct is a thing the user should see themselves choosing.
      process.stdout.write(`voice overridden for this run: ${args.voice}\n`);
    }

    const report = await workRun(store, host, {
      owner: `cli-${String(process.pid)}`,
      clock: now,
      spendCeiling: args.ceiling,
      concurrency: args.concurrency,
      leaseMs: args.leaseMinutes * 60 * 1000,
      run: args.run,
      // Establishes the signing secret on first dispatch; every task gets a
      // capability token scoped to its own lease (commitment 14).
      capabilitySecret: loadOrCreateSecret(secretFile()),
      // What the declared ground already checks about itself, so a lens's
      // obligation can name the repository's own gate instead of only the
      // standard behind it.
      manifests: readRepoManifest,
      // What method the machine can offer a role beyond its lens: the skills
      // library, read where it actually sits rather than assumed present.
      skills: readReachableSkills,
      // Rendered prose only — the work log and every timestamp this run
      // writes are the same bytes no matter what this resolves to.
      locale: resolvedLocale(store, { env }),
      ...(args.voice ? { voice: { instruction: args.voice, source: 'cli --voice' } } : {}),
    });

    process.stdout.write(
      `worked ${String(report.dispatched)} task(s) on ${host.name}: ` +
        `${String(report.completed)} done, ${String(report.failed)} failed.\n`,
    );
    if (report.slotGapsRaised > 0) {
      process.stdout.write(
        `${String(report.slotGapsRaised)} deliverable(s) came back with required sections unfilled; ` +
          'each is one inbox decision carrying the default the draft proceeds on. See: construct inbox\n',
      );
    }
    // Only what this invocation settled. Listing everything settled in the
    // store would report a second run's work as this one's.
    for (const id of report.settled) {
      const task = getTask(store, id);
      if (!task) continue;
      if (task.state === 'failed') {
        process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${escapeForTerminal(failureLine(task.error))}\n`);
        continue;
      }
      const cost = task.spendReported ? `$${money(task.spend)}` : 'cost not reported';
      process.stdout.write(`  ✓ ${task.role.padEnd(20)} ${cost}\n`);

      // The two lines a user has to see: what is wrong with this deliverable,
      // and whether anyone is allowed to rely on it as it stands.
      for (const concern of deliverableConcerns(task.result)) {
        process.stdout.write(`      ⚑ ${escapeForTerminal(concern.detail)}\n`);
      }
      const review = licensedReviewFor(task.role);
      if (review) {
        process.stdout.write(
          `      → issue-spotting only: needs review by a licensed ${review} before you rely on it\n`,
        );
      }
    }

    // One merged issue list instead of N overlapping essays. The merge is
    // lexical and labeled; a duplicate it fails to merge shows twice rather
    // than losing anything.
    const settledDeliverables = report.settled
      .map((id) => getTask(store, id))
      .filter((task) => task !== null && task.state === 'done')
      .map((task) => {
        const draft = latestDraft(store, task!.id)?.deliverable ?? task!.result;
        const text =
          typeof draft === 'string'
            ? draft
            : typeof (draft as { text?: unknown } | null)?.text === 'string'
              ? ((draft as { text: string }).text)
              : null;
        return text === null ? null : { role: task!.role, text };
      })
      .filter((d): d is { role: string; text: string } => d !== null);
    const merged = synthesizeIssues(settledDeliverables);
    if (merged.length > 0) {
      const settledRun = report.settled.map((id) => getTask(store, id)).find((t) => t !== null)?.run;
      const authority = settledRun ? citedAuthorityFor(store, settledRun) : undefined;
      process.stdout.write(`\nissues across roles (${String(merged.length)}, merged lexically):\n`);
      for (const [index, issue] of merged.entries()) {
        process.stdout.write(`  ${String(index + 1)}. [${issue.roles.join(', ')}] ${escapeForTerminal(renderClaim(issue.text, authority))}\n`);
      }
    }

    // "spend 0 of 10.00 ceiling" after a run where nothing completed reads as
    // "this was cheap" when the true statement is that nothing ran. The
    // costSilent branch below does not cover it: these tasks failed rather than
    // completing without reporting a cost.
    if (report.completed === 0 && report.failed > 0) {
      writeTotalFailureRecourse(report.failed);
    } else {
      // What this invocation spent, against what it was allowed to spend. The
      // lifetime total is a different fact and was being printed under this
      // sentence, so a store with history read as a run that had nearly
      // exhausted its budget before starting.
      process.stdout.write(
        `\nreported cost ${money(report.spendAfter - report.spendBefore)} of ` +
          `${money(report.spendCeiling)} allowed for this run ` +
          `(${money(report.spendAfter)} recorded across every run in this store).\n`,
      );
    }
    if (report.conflicts > 0) {
      // The inbox is the point of the whole run: work happened in the
      // background, and this is the part that is genuinely the user's.
      process.stdout.write(
        `\n${String(report.conflicts)} decision(s) need you — the roles disagree.\n` +
          'See: construct inbox\n',
      );
    }
    if (report.recovered > 0) {
      process.stdout.write(
        `recovered ${String(report.recovered)} task(s) from an earlier run that did not finish.\n`,
      );
    }
    if (report.degraded > 0) {
      // Degrade loudly. The run happened and the deliverables
      // are real; what must not happen is anyone citing them without knowing
      // what produced them.
      process.stdout.write(
        `${String(report.degraded)} task(s) ran below the model capability floor their brief declared. ` +
          'Those deliverables are qualified by the model that produced them — see: construct log\n',
      );
    }
    if (report.costSilent > 0) {
      // Saying "under the ceiling" about spend nobody measured is the same
      // class of claim commitment 15 exists to forbid.
      process.stdout.write(
        `${String(report.costSilent)} task(s) ran on a host that reported no cost. ` +
          'The ceiling did not bind on those.\n',
      );
    }
    if (report.halted === 'spend-ceiling') {
      const left = countTasksByState(store, args.run).pending ?? 0;
      process.stdout.write(
        `\nhalted: this run reached the ${money(report.spendCeiling)} ceiling. ` +
          `${String(left)} task(s) left pending — raise it with --ceiling=<amount> to continue.\n` +
          'The figure is what a host reports each call costs. On a subscription host that is an ' +
          'estimate of work done rather than an amount charged, so the ceiling bounds how much ' +
          'work a run may do and is not a spending limit.\n',
      );
      return 1;
    }
    return report.failed > 0 ? 1 : 0;
  });
}
