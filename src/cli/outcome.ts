/**
 * cli/outcome.ts — writing down what you want to happen, and the plan the run
 * works from.
 *
 * Without a host named this path is deterministic, does no I/O beyond the
 * store, and costs nothing. With one, that host's model reads every outcome as
 * the primary namer and the keyword map is only the fallback if the model
 * fails. Inside an ambient host session, this verb does not consult the
 * keyword map and does not create a run: the host infers, and the only
 * surfaces are this session's dispatch or the inbox. The plan is recorded
 * write-once here so `work` executes against a stated plan rather than an
 * implicit one, which is why `ask` and the standing firings both come back
 * through this file to record theirs.
 */

import type { Store } from '../kernel/store/open.ts';
import { appendWorkLog } from '../kernel/store/worklog.ts';
import { recordRunDispatch } from '../kernel/store/dispatch.ts';
import { engagementMode, sourcesFor } from '../kernel/store/sources.ts';
import { storeNamingCache } from '../kernel/store/namings.ts';
import { recordPlan } from '../kernel/store/plans.ts';
import { buildPlan } from '../kernel/plan/planner.ts';
import { startRun, startRunNamed, startRunSelected } from '../kernel/run/outcome.ts';
import type { StartedRun } from '../kernel/run/outcome.ts';
import type { Implication } from '../kernel/implication/map.ts';
import type { DensifiedIntake } from '../kernel/intake/densify.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { createHostDensifier } from '../hosts/densifier.ts';
import type { DensifiedReply } from '../hosts/densifier.ts';
import { createHostNamer } from '../hosts/namer.ts';
import { adapterForHost, HOST_NAMES, now, withStoreAsync } from './runtime.ts';
import type { HostName } from './runtime.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { sessionNamingPacket, usesSessionDispatch, type AmbientDetection } from '../hosts/session.ts';
import { firstUnknownFlag, isHelpFlag, parseHostFlags, wantsHelp, workspaceFlag } from './flags.ts';
import { effectiveWorkspace, SHARED_DEFAULT_WORKSPACE_NOTICE } from './settings.ts';

const OUTCOME_USAGE =
  'usage: construct outcome [--host=<opencode|claude|codex|cursor> [--model=…] [--binary=…]] ' +
  '[--domains=<name,…>] [--workspace=<name>] [--timeout=<minutes>] "<what you want to happen>"\n';

/**
 * What an in-session first-run prints when a host already has the words.
 * No run is created: a hollow or keyword-staffed record would look like
 * staffing happened. Construct does not classify the intent. The host infers.
 * Two surfaces only: this session dispatches, or the turn goes to inbox.
 */
export function sessionOutcomeHandoff(session: AmbientDetection, words: string): string {
  return sessionNamingPacket(session, words);
}

export interface OutcomeArgs {
  readonly text: string;
  /**
   * Naming a host is the opt-in to spend (the original opt-in rule, carried into
   * the inversion): recording an outcome without one is free and deterministic,
   * and a model charge at the moment a user writes down an intention is the
   * least expected charge in the product. With a host named, its model is the
   * primary namer on every outcome (adopted 2026-08-05).
   */
  readonly host?: HostName;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /**
   * Domains the user named outright. Inference is the door for the user who
   * does not know what to ask for; this is the door for the user who does.
   */
  readonly domains?: readonly string[];
  /**
   * Which workspace's declared sources and engagement mode the plan is built
   * from. `source add` and `ask` already take it; a run that could not be
   * pointed at the same ground they were is a flag that means something on one
   * command and nothing on the next. This is the parsed default; the run
   * resolves the effective workspace against the settings ladder (an explicit
   * flag, then a ratified project binding, then the shared default) once it
   * holds the store.
   */
  readonly workspace: string;
  /** The raw `--workspace` value, or undefined — what the ladder resolution starts from. */
  readonly explicitWorkspace?: string;
  /** How long one host invocation may run, in milliseconds. Host default when unset. */
  readonly timeoutMs?: number;
}

export function parseOutcomeArgs(argv: string[]): OutcomeArgs {
  const flags: Record<string, string> = {};
  const words: string[] = [];

  for (const arg of argv) {
    if (arg === '--escalate') {
      // Removed with the inversion, loudly: silence here would read as the
      // old behavior still existing.
      throw new Error(
        '--escalate was removed: a named host\'s model is primary on every outcome now; use --host=<opencode|claude|codex|cursor>',
      );
    }
    // Help is answered by the caller before any text is recorded; it is never
    // a word of the outcome.
    if (isHelpFlag(arg)) continue;
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
      continue;
    }
    words.push(arg);
  }

  // Outcome text is free-form, but a leading `--flag` that names nothing is a
  // typo, not a word: swallowing it into the outcome would record something
  // other than what was meant into a log nobody can edit. Quoting the sentence
  // is the escape hatch for a genuine `--` in the text.
  const unknown = firstUnknownFlag(argv, new Set(['host', 'model', 'binary', 'dir', 'timeout', 'domains', 'workspace']));
  if (unknown !== undefined) {
    throw new Error(`unknown flag ${unknown}; quote it inside the outcome text if it belongs there`);
  }

  // A flag that is quietly ignored is a flag that lies. --model/--binary/--dir
  // only mean something when a model is going to be consulted, so supplying one
  // without --host is a usage error rather than a silent no-op. Both that rule
  // and the list of nameable hosts come from the one parser every model-calling
  // surface reads, so a host the adapters gained is nameable here without a
  // second edit that can be forgotten.
  const { host, model, binary, dir, timeoutMs } = parseHostFlags(flags);

  const domains =
    flags.domains === undefined
      ? undefined
      : flags.domains
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0);

  // Same rule, other direction: naming the domains skips inference entirely,
  // so a host would be consulted for nothing and charged for it.
  if (domains !== undefined && host !== undefined) {
    throw new Error(
      '--domains names the staff outright, so no model is consulted; drop --host, or drop --domains to let it infer',
    );
  }
  if (domains !== undefined && domains.length === 0) {
    throw new Error('--domains needs at least one domain name');
  }

  return {
    text: words.join(' ').trim(),
    host,
    model,
    binary,
    dir,
    domains,
    workspace: workspaceFlag(flags),
    ...(flags.workspace === undefined ? {} : { explicitWorkspace: flags.workspace }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/**
 * Build and record the run's plan from what the run already established: the
 * implicated domains and how they were inferred, the workspace's declared
 * sources, and its engagement mode. Recorded write-once at outcome time so
 * `work` executes against a stated plan rather than an implicit one.
 */
export function planRun(
  store: Store,
  started: StartedRun,
  densified: DensifiedIntake | null,
  workspace: string,
  at: string,
  /**
   * The concerns this run will actually dispatch, when that is narrower than
   * what it implicated. A question is answered by one of them, and a plan
   * listing steps nobody will work would be a schedule of work that is not
   * going to happen.
   */
  dispatching?: readonly Implication[],
  /**
   * Where the plan's own line goes. A caller with no terminal — the resident
   * sweeper, whose stdout is a shared logfile — passes its own sink rather
   * than leaving unstamped lines interleaved among timestamped ones.
   */
  say: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
): void {
  const plan = buildPlan({
    id: `plan-${started.runId}`,
    run: started.runId,
    outcome: started.outcome,
    densified,
    implicated: dispatching ?? started.implicated,
    inferredBy: started.inferredBy,
    sources: sourcesFor(store, workspace),
    workspace,
    mode: engagementMode(store, workspace),
    plannedAt: at,
  });
  recordPlan(store, plan);
  say(
    `\nplan ${plan.id}: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, ` +
      `risk ${plan.riskTier}` +
      (plan.sourcesDeclared.length > 0
        ? `, over ${plan.sourcesDeclared.length} declared source${plan.sourcesDeclared.length === 1 ? '' : 's'} (read at work time)`
        : ', no sources declared') +
      // Which workspace was consulted, whenever it is not the one a reader
      // would assume. "No sources declared" against a workspace the user did
      // not mean is indistinguishable from having declared none at all.
      (workspace === 'default' ? '' : ` on workspace "${workspace}"`) +
      `\n  construct plan ${started.runId}\n`,
  );
  for (const d of plan.discarded) {
    say(`  discarded: ${escapeForTerminal(d.description)} — ${escapeForTerminal(d.reason)}\n`);
  }
}

export function reportRun(started: StartedRun, env: NodeJS.ProcessEnv = process.env): void {
  process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
  process.stdout.write(`implicated domains (${started.implicated.length}):\n`);
  for (const implication of started.implicated) {
    process.stdout.write(`  ${implication.domain}  — ${escapeForTerminal(implication.concern)}\n`);
    // Named implications carry no keyword score, so reporting one would
    // invite comparison with numbers that mean something else entirely.
    const evidence =
      started.inferredBy === 'keywords'
        ? `signals: ${implication.signals.slice(0, 4).join(', ')} (score ${implication.score})`
        : `reason: ${implication.signals.join(' ')}`;
    process.stdout.write(`      ${escapeForTerminal(evidence)}\n`);
  }
  if (started.inferredBy === 'user') {
    process.stdout.write('\nYou named these; nothing was inferred and no model was consulted.\n');
  }
  if (
    started.inferredBy === 'namer' ||
    started.inferredBy === 'cache' ||
    started.inferredBy === 'session' ||
    started.inferredBy === 'ground'
  ) {
    process.stdout.write(
      started.inferredBy === 'cache'
        ? '\nThese came from a model consulted for this outcome earlier, not from keywords.\n'
        : started.inferredBy === 'session'
          ? '\nThese came from this session reading the outcome; each reason above is its stated evidence.\n'
          : started.inferredBy === 'ground'
            ? '\nThese came from visible ground (declared sources and local docs), not from the keyword map.\n'
            : '\nThese came from a model reading the outcome; each reason above is its stated evidence.\n',
    );
  }
  if (started.namerFailure !== undefined) {
    // A keyword answer standing in for a model's is a degradation, and the
    // user hears it here as well as in the log.
    process.stdout.write(
      `\nThe model could not be consulted (${escapeForTerminal(started.namerFailure)}); the keyword map answered instead.\n`,
    );
  }
  if (started.namerRetriedAfter !== undefined) {
    // A repaired reply is the model's answer, but it took a second call to
    // get it, and the fragility should not read as a clean first turn.
    process.stdout.write(
      `\nThe model's first reply could not be parsed (${escapeForTerminal(started.namerRetriedAfter)}); ` +
        'a corrective retry produced this answer.\n',
    );
  }
  process.stdout.write(
    `\nfiled ${started.logged.length} work log entries and queued ${started.tasks.length} task(s).\n`,
  );
  // The command named here is the one `construct work` would actually pick
  // with no --host typed — an ambient host with a wired adapter, when there
  // is one — so what is relayed and what would run never say two things.
  const ambient = detectAmbientHost(env);
  const ambientWired = ambient !== null && (HOST_NAMES as readonly string[]).includes(ambient.host);
  process.stdout.write(
    `Run them:  construct work --run ${started.runId}` + (ambientWired ? ` --host=${ambient.host}` : '') + '\n',
  );
  process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
}

/**
 * Record an outcome.
 *
 * Without --host the path is deterministic, does no I/O beyond the store, and
 * costs nothing — the keyword map answers or it does not, except inside an
 * ambient host session, where the map is not consulted, no run is created,
 * and the host infers (session dispatch or inbox — not a Construct classifier).
 * With --host, that host's model reads every outcome as the primary namer and
 * the map is only the fallback if the model fails (adopted 2026-08-05 on the
 * RESEARCH-DECISIONS.md §10 figures: on wording the catalog's authors never
 * wrote, the map missed 0.634 where the namer missed 0.301).
 *
 * `hostOverride` exists so the CLI's own wiring is testable without a binary
 * present, exactly as with `work`.
 */
export async function outcome(
  argv: string[],
  hostOverride?: HostAdapter,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  // Answered before the text is read, so no run is recorded for a request for
  // help.
  if (wantsHelp(argv)) {
    process.stdout.write(OUTCOME_USAGE);
    return 0;
  }
  let args: OutcomeArgs;
  try {
    args = parseOutcomeArgs(argv);
  } catch (error) {
    process.stderr.write(`outcome: ${(error as Error).message}\n${OUTCOME_USAGE}`);
    return 2;
  }
  if (!args.text) {
    process.stderr.write(OUTCOME_USAGE);
    return 2;
  }

  return withStoreAsync(async (store) => {
    const at = now();
    const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;

    // The workspace this run's plan and records belong to, resolved against the
    // settings ladder now that the store is open: an explicit --workspace, then
    // a ratified project binding, then the shared default. The warning fires
    // before the run is recorded, so a run about to pool in the shared default
    // says so before it is filed rather than after.
    const { workspace, unboundDefault } = effectiveWorkspace(store, args.explicitWorkspace);
    if (unboundDefault) process.stderr.write(`outcome: ${SHARED_DEFAULT_WORKSPACE_NOTICE}\n`);

    // Named staff: no map, no model, no cost — but the same catalog gate.
    if (args.domains !== undefined) {
      let started: StartedRun;
      try {
        started = startRunSelected(store, {
          runId,
          outcome: args.text,
          at,
          domains: args.domains,
        });
      } catch (error) {
        process.stderr.write(`outcome: ${(error as Error).message}\n`);
        return 2;
      }
      reportRun(started, env);
      planRun(store, started, null, workspace, at);
      return 0;
    }

    const session = usesSessionDispatch(env, {
      host: args.host,
      hostExplicit: args.host !== undefined,
      binary: args.binary,
    });
    // In-session first-run: the host that already read these words infers.
    // Creating a hollow run here poisons the next `work` (it becomes the
    // latest record and steals the default) and looks like staffing happened.
    // A typed --host that names this session is still this session.
    // hostOverride / --binary is the spawn-path / namer test seam.
    if (session !== null && hostOverride === undefined) {
      process.stdout.write(sessionOutcomeHandoff(session, args.text));
      return 0;
    }

    if (args.host === undefined) {
      const started = startRun(store, { runId, outcome: args.text, at });
      if (started.implicated.length === 0) {
        process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
        process.stdout.write(
          'no domains implicated. Nothing was inferred — this is recorded, not silently dropped.\n',
        );
        // The signpost that makes the dead end a choice rather than a wall
        //: the user, not the tool, decides to spend money. Named first, when
        // detected, is the host this process is already running inside — the
        // command a user in that session would actually want to type — with
        // the full list still shown as every other way to spend.
        const ambient = detectAmbientHost(env);
        const ambientWired = ambient !== null && (HOST_NAMES as readonly string[]).includes(ambient.host);
        process.stdout.write(
          '\nA host model can be asked instead, at cost:\n' +
            (ambientWired
              ? `  construct outcome --host=${ambient.host} ${JSON.stringify(args.text)}  ` +
                `(this session is running inside ${ambient.host})\n`
              : '') +
            `  construct outcome --host=<opencode|claude|codex|cursor> ${JSON.stringify(args.text)}\n`,
        );
        planRun(store, started, null, workspace, at);
        return 0;
      }
      reportRun(started, env);
      planRun(store, started, null, workspace, at);
      return 0;
    }

    const host =
      hostOverride ??
      adapterForHost(args.host, {
        binary: args.binary,
        model: args.model,
        dir: args.dir,
        timeoutMs: args.timeoutMs,
        env,
      });

    try {
      await host.init();
    } catch (error) {
      process.stderr.write(
        `outcome: host "${host.name}" is not available — ${(error as Error).message}\n`,
      );
      return 1;
    }

    // With a host already being paid for this outcome, the rough framing is
    // optimized here rather than by the user remembering to ask. The original
    // words stay the outcome; the densified form is a recorded companion the
    // namer reads. A densifier failure is a stated fallback to the raw text.
    let densified: DensifiedReply | null = null;
    let densifyFailure: string | undefined;
    try {
      densified = await createHostDensifier(host)(args.text);
    } catch (error) {
      densifyFailure = (error as Error).message;
    }

    const started = await startRunNamed(store, {
      runId,
      outcome: args.text,
      at,
      host: host.name,
      namer: createHostNamer(host),
      cache: storeNamingCache(store, { host: host.name, at }),
      namerText: densified?.outcome,
    });

    if (densified) {
      appendWorkLog(store, {
        run: started.runId,
        task: null,
        role: 'construct',
        action: 'intake-densified',
        detail: densified,
        at,
      });
      if (densified.retriedAfter !== undefined) {
        process.stdout.write(
          `intake's first reply could not be parsed (${escapeForTerminal(densified.retriedAfter)}); ` +
            'a corrective retry produced this understanding.\n',
        );
      }
      process.stdout.write(`as understood (your words are the record; correct this if it is wrong):\n`);
      process.stdout.write(`  outcome: ${escapeForTerminal(densified.outcome)}\n`);
      for (const c of densified.constraints) process.stdout.write(`  constraint: ${escapeForTerminal(c)}\n`);
      for (const d of densified.decisions) process.stdout.write(`  decided: ${escapeForTerminal(d)}\n`);
      for (const p of densified.parked) process.stdout.write(`  parked: ${escapeForTerminal(p)}\n`);
      // Fail-open, never a gate: staffing proceeds either way. What this buys
      // is the reader seeing, before paying for the run, that the outcome was
      // thin enough to need a guess — rather than finding out only from what
      // the roles guessed.
      if (densified.underspecified.length > 0) {
        process.stdout.write(
          `  this is thin enough that staffing will have to guess: ${escapeForTerminal(densified.underspecified)}\n` +
            '  staffing proceeds on that guess; nothing here blocks the run.\n',
        );
      }
      process.stdout.write('\n');
    } else if (densifyFailure !== undefined) {
      process.stdout.write(
        `the outcome could not be optimized at intake (${escapeForTerminal(densifyFailure)}); the raw text is used as given.\n\n`,
      );
    }

    // The host and model named here are facts of the run. Without this record,
    // a later `work` with no flags dispatched to whatever model the host last
    // used — observed on a wire capture as an image model answering legal work.
    recordRunDispatch(store, {
      run: started.runId,
      host: args.host ?? host.name,
      model: args.model,
      binary: args.binary,
      dir: args.dir,
      recordedAt: at,
    });

    if (started.implicated.length === 0) {
      process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
      process.stdout.write(
        started.namerFailure !== undefined
          ? `no domains implicated. ${host.name} could not be consulted (${escapeForTerminal(started.namerFailure)}) ` +
              'and the keyword map is silent too — this is recorded, not silently dropped.\n'
          : `no domains implicated. ${host.name} considered the catalog and named nothing — ` +
              'this is recorded, not silently dropped.\n',
      );
      planRun(store, started, densified, workspace, at);
      return 0;
    }
    reportRun(started, env);
    planRun(store, started, densified, workspace, at);
    return 0;
  });
}
