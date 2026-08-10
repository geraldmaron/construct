/**
 * cli/index.ts — the one CLI. Phase 0 surface: doctor, version. Phase 1 adds
 * cleanup. Commands stay few; capability grows in packs and kernel libraries,
 * not in CLI surface.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolvePaths } from '../kernel/paths.ts';
import { buildCleanupCatalog } from '../kernel/cleanup/catalog.ts';
import type { SpawnFn } from '../kernel/cleanup/catalog.ts';
import { detectedItems, selectedItems, applyCleanup } from '../kernel/cleanup/run.ts';
import type { CleanupOptions } from '../kernel/cleanup/run.ts';
import { writeFileSync } from 'node:fs';
import { openStore, storePath, storeWriteProblem, StoreUnavailableError } from '../kernel/store/open.ts';
import type { Store } from '../kernel/store/open.ts';
import { appendWorkLog, readWorkLog } from '../kernel/store/worklog.ts';
import { readRunDispatch, recordRunDispatch } from '../kernel/store/dispatch.ts';
import {
  addSource,
  ENGAGEMENT_MODES,
  engagementMode,
  getSource,
  retireSource,
  setEngagementMode,
  SOURCE_KINDS,
  sourcesFor,
} from '../kernel/store/sources.ts';
import { recordRunSourceReads } from '../kernel/run/sourcereads.ts';
import type { SourceSurvey } from '../kernel/run/sourcereads.ts';
import { surveySource } from '../hosts/sources.ts';
import type { EngagementMode, SourceKind } from '../kernel/store/sources.ts';
import { createHostDensifier } from '../hosts/densifier.ts';
import type { DensifiedIntake } from '../kernel/intake/densify.ts';
import type { DensifiedReply } from '../hosts/densifier.ts';
import { recordNote, resolveNoteCitation } from '../kernel/store/notes.ts';
import { applyContextLoop } from '../kernel/context/loop.ts';
import type { MemoryDelta, PropagationProposal } from '../kernel/context/loop.ts';
import { toProducedLoop } from '../kernel/context/produce.ts';
import type { DeltaChallenge, ProducedLoop } from '../kernel/context/produce.ts';
import { screenObservations } from '../kernel/context/observations.ts';
import { operationalLessonsFor } from '../kernel/lessons/admission.ts';
import { createHostChallenger, createHostProducer } from '../hosts/contextloop.ts';
import { openDecisions, resolveDecision } from '../kernel/store/decisions.ts';
import { countTasksByState, getTask, listTasks } from '../kernel/store/tasks.ts';
import { readFeedback } from '../kernel/store/feedback.ts';
import { harvestCorpus } from '../kernel/implication/harvest.ts';
import {
  recordVerdict,
  runOutcomeText,
  surfacedDomains,
  UnsurfacedVerdictError,
} from '../kernel/implication/verdict.ts';
import type { RecordedVerdict } from '../kernel/implication/verdict.ts';
import { startRun, startRunNamed, startRunSelected } from '../kernel/run/outcome.ts';
import type { StartedRun } from '../kernel/run/outcome.ts';
import { storeNamingCache } from '../kernel/store/namings.ts';
import { createHostNamer } from '../hosts/namer.ts';
import { DEFAULT_CONCURRENCY, frameConflicts, workRun } from '../kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor } from '../kernel/run/accountability.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { createOpenCodeAdapter } from '../hosts/opencode/adapter.ts';
import { createClaudeAdapter } from '../hosts/claude/adapter.ts';
import { loadOrCreateSecret, loadSecret } from '../kernel/capabilities/secretfile.ts';
import { readRoleEnv } from '../kernel/run/roleenv.ts';
import { serveRole } from './roleserve.ts';
import { serveProjection } from '../hosts/mcp/projection.ts';
import { gatherRepoEvidence, isFailure } from '../hosts/repo/evidence.ts';
import { reconcileSession } from '../kernel/tracker/session-drift.ts';
import { constructFindings, CONSTRUCT_GROUND } from '../kernel/watch/construct-ground.ts';
import { startWatch, sweepWatch, watchRun } from '../kernel/watch/watch.ts';
import { latestDraft, promotionOf, waiveChallenge } from '../kernel/run/promotion.ts';
import { buildPlan } from '../kernel/plan/planner.ts';
import { synthesizeIssues } from '../kernel/run/synthesis.ts';
import { planFor, recordPlan } from '../kernel/store/plans.ts';
import type { Watch } from '../kernel/watch/watch.ts';
import { join } from 'node:path';
import { tuningStamp } from '../hosts/tuning.ts';
import { probeDocling, readSource } from '../hosts/extract.ts';

const MIN_NODE = { major: 22, minor: 18 };

function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { version: string }).version;
}

function nodeFloorOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major !== MIN_NODE.major) return major > MIN_NODE.major;
  return minor >= MIN_NODE.minor;
}

export function doctor(): number {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'node',
    ok: nodeFloorOk(process.versions.node),
    detail: `v${process.versions.node} (floor: ${MIN_NODE.major}.${MIN_NODE.minor})`,
  });

  const paths = resolvePaths();
  checks.push({ name: 'paths', ok: true, detail: `state: ${paths.stateDir}` });

  // Stale-loudly: the stamp carries the dates the tuning evidence was
  // recorded, so an aging matrix reads as aged instead of current.
  checks.push({ name: 'matrix', ok: true, detail: tuningStamp() });

  // Resolving a path proves nothing about being able to use it. Before this
  // check, doctor reported "healthy" against a data dir it could not write,
  // and the user found out from a stack trace on their next command.
  const store = storePath(paths);
  const problem = storeWriteProblem(store);
  checks.push({
    name: 'store',
    ok: problem === null,
    detail: problem === null ? store : `${store} — ${problem}`,
  });

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}  ${check.detail}\n`);
  }
  process.stdout.write(failed === 0 ? 'doctor: healthy\n' : `doctor: ${failed} check(s) failed\n`);
  return failed === 0 ? 0 : 1;
}

interface CleanupArgs extends CleanupOptions {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly withImages: boolean;
  readonly cwd: string;
  readonly home: string;
}

export function parseCleanupArgs(argv: string[]): CleanupArgs {
  let scope: CleanupOptions['scope'] = 'all';
  let dryRun = false;
  let yes = false;
  let all = false;
  let keepState = false;
  let withImages = false;
  let cwd = process.cwd();
  let home = homedir();
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--all') all = true;
    else if (arg === '--keep-state') keepState = true;
    else if (arg === '--with-images') withImages = true;
    else if (arg.startsWith('--scope=')) scope = arg.slice('--scope='.length) as CleanupOptions['scope'];
    else if (arg.startsWith('--cwd=')) cwd = arg.slice('--cwd='.length);
    else if (arg.startsWith('--home=')) home = arg.slice('--home='.length);
  }
  if (!['project', 'machine', 'all'].includes(scope)) {
    throw new Error(`Invalid --scope=${scope}; expected project|machine|all`);
  }
  return { scope, dryRun, yes, all, keepState, withImages, cwd, home };
}

// `spawnOverride` exists only so tests can fake out docker/launchctl instead
// of depending on the real machine's ambient state; production callers never
// pass it.
export function cleanup(argv: string[], spawnOverride?: SpawnFn): number {
  const args = parseCleanupArgs(argv);
  const paths = resolvePaths(process.env, args.home);
  const catalog = buildCleanupCatalog({
    cwd: args.cwd,
    home: args.home,
    paths,
    withImages: args.withImages,
    spawn: spawnOverride,
  });
  const detected = detectedItems(catalog, args);

  if (detected.length === 0) {
    process.stdout.write('cleanup: no predecessor state detected in the selected scope.\n');
    return 0;
  }

  if (args.dryRun) {
    process.stdout.write(`cleanup: dry-run plan (scope=${args.scope}${args.keepState ? ', keep-state' : ''}):\n`);
    let removable = 0;
    for (const item of detected) {
      // A kept item must not wear the mark that means "this will be removed".
      // Saying KEPT beside a ✓ under "pass --yes to remove ✓ items" is a
      // contradiction, and the mark is what gets read.
      const keeping = item.keeps?.() ?? false;
      if (!keeping) removable += 1;
      const mark = keeping ? '•' : item.risk === 'auto' ? '✓' : '◐';
      process.stdout.write(`  ${mark} ${item.label}\n      ${item.describe()}\n`);
    }
    process.stdout.write(
      removable === 0
        ? '\nNothing to remove: every detected item belongs to the Construct that is running.\n'
        : '\nPass --yes to remove ✓ items, --yes --all to also remove ◐ items. • items are kept either way.\n',
    );
    return 0;
  }

  if (!args.yes) {
    process.stderr.write('cleanup: pass --dry-run to preview, or --yes (optionally --all) to apply.\n');
    return 2;
  }

  const toRemove = selectedItems(detected, args.all);
  const result = applyCleanup(detected, new Set(toRemove.map((item) => item.id)));
  // An item that reports "kept" ran and deliberately removed nothing — the
  // successor owns that directory. Counting it as removed would
  // make the summary say a thing was deleted that is still there, which is the
  // class of claim this project exists to not make.
  const kept = result.removed.filter((o) => o.detail.startsWith('kept'));
  const actuallyRemoved = result.removed.filter((o) => !o.detail.startsWith('kept'));
  for (const outcome of actuallyRemoved) {
    process.stdout.write(`  ✓ ${outcome.label} — ${outcome.detail}\n`);
  }
  for (const outcome of kept) {
    process.stdout.write(`  • ${outcome.label} — ${outcome.detail}\n`);
  }
  process.stdout.write(
    `\ncleanup: removed ${String(actuallyRemoved.length)}, ` +
      `kept ${String(kept.length)}, skipped ${String(result.skipped.length)}.\n`,
  );
  return actuallyRemoved.some((o) => o.detail.startsWith('error:')) ? 1 : 0;
}

/**
 * The spine commands. The CLI is the host here, so it is the CLI that supplies
 * the clock and the run id — the kernel does neither.
 */
function withStore<T>(fn: (store: Store) => T): T {
  const store = openStore(storePath(resolvePaths()));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/**
 * The async twin. Separate rather than generic over both, because a `finally`
 * that closes the store around a function returning a promise closes it while
 * the work is still running — the failure mode is a coordinator writing to a
 * closed database, and it only shows up under load.
 */
async function withStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const store = openStore(storePath(resolvePaths()));
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

function now(): string {
  return new Date().toISOString();
}

/** Where the token-signing secret lives: next to the store it guards. */
function secretFile(): string {
  return join(resolvePaths().dataDir, 'capability-secret');
}

/**
 * Serve one role's write surface over MCP stdio. Not in USAGE on purpose:
 * a host's MCP configuration launches this with the role environment set by
 * the dispatcher (see kernel/run/roleenv.ts); it is plumbing a person never
 * types. The secret is load-only here — a serving process that invented a
 * fresh secret would deny every honestly-minted token as a forgery, and that
 * misconfiguration should read as this one line instead.
 */
async function roleServe(): Promise<number> {
  const scope = readRoleEnv(process.env);
  if (!scope) {
    process.stderr.write(
      'role-serve: missing CONSTRUCT_ROLE_TOKEN / CONSTRUCT_ROLE_RUN / CONSTRUCT_ROLE_TASK — ' +
        'this command is launched by a host with the dispatcher-set role environment.\n',
    );
    return 2;
  }
  const secret = loadSecret(secretFile());
  if (secret === null) {
    process.stderr.write(
      'role-serve: no capability secret exists yet — it is established the first time "construct work" dispatches.\n',
    );
    return 1;
  }
  const store = openStore(storePath(resolvePaths()));
  try {
    await serveRole(
      {
        store,
        secret,
        token: scope.token,
        run: scope.run,
        task: scope.task,
        clock: now,
        serverVersion: packageVersion(),
      },
      process.stdin,
      process.stdout,
    );
  } finally {
    store.close();
  }
  return 0;
}

/**
 * Serve the spine's projection over MCP stdio: presence inside whatever MCP
 * host the user already works in (one server, every host — commitment 1's
 * amendment). An MCP configuration launches this ({"command": "construct",
 * "args": ["serve"]}); it holds no capability secret and exposes no dispatch
 * and no completion writes — those stay on `work` and the role server.
 */
async function serve(): Promise<number> {
  return withStoreAsync(async (store) => {
    await serveProjection(
      { store, clock: now, serverVersion: packageVersion() },
      process.stdin,
      process.stdout,
    );
    return 0;
  });
}

const OUTCOME_USAGE =
  'usage: construct outcome [--host=<opencode|claude> [--model=…] [--binary=…]] ' +
  '[--domains=<name,…>] "<what you want to happen>"\n';

export interface OutcomeArgs {
  readonly text: string;
  /**
   * Naming a host is the opt-in to spend (the original opt-in rule, carried into
   * the inversion): recording an outcome without one is free and deterministic,
   * and a model charge at the moment a user writes down an intention is the
   * least expected charge in the product. With a host named, its model is the
   * primary namer on every outcome (adopted 2026-08-05).
   */
  readonly host?: 'opencode' | 'claude';
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /**
   * Domains the user named outright. Inference is the door for the user who
   * does not know what to ask for; this is the door for the user who does.
   */
  readonly domains?: readonly string[];
}

export function parseOutcomeArgs(argv: string[]): OutcomeArgs {
  const flags: Record<string, string> = {};
  const words: string[] = [];

  for (const arg of argv) {
    if (arg === '--escalate') {
      // Removed with the inversion, loudly: silence here would read as the
      // old behavior still existing.
      throw new Error(
        '--escalate was removed: a named host\'s model is primary on every outcome now; use --host=<opencode|claude>',
      );
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
      continue;
    }
    words.push(arg);
  }

  const host = flags.host;
  if (host !== undefined && host !== 'opencode' && host !== 'claude') {
    throw new Error(`unknown host "${host}" (expected opencode or claude)`);
  }

  // A flag that is quietly ignored is a flag that lies. --model/--binary/--dir
  // only mean something when a model is going to be consulted, so supplying one
  // without --host is a usage error rather than a silent no-op.
  const hostFlags = ['model', 'binary', 'dir'].filter((f) => flags[f] !== undefined);
  if (host === undefined && hostFlags.length > 0) {
    throw new Error(
      `--${hostFlags[0]} only applies when a host is named; add --host=<opencode|claude>, or drop the flag`,
    );
  }

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
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
    domains,
  };
}

/**
 * Build and record the run's plan from what the run already established: the
 * implicated domains and how they were inferred, the workspace's declared
 * sources, and its engagement mode. Recorded write-once at outcome time so
 * `work` executes against a stated plan rather than an implicit one.
 */
function planRun(
  store: Store,
  started: StartedRun,
  densified: DensifiedIntake | null,
  workspace: string,
  at: string,
): void {
  const plan = buildPlan({
    id: `plan-${started.runId}`,
    run: started.runId,
    outcome: started.outcome,
    densified,
    implicated: started.implicated,
    inferredBy: started.inferredBy,
    sources: sourcesFor(store, workspace),
    mode: engagementMode(store, workspace),
    plannedAt: at,
  });
  recordPlan(store, plan);
  process.stdout.write(
    `\nplan ${plan.id}: ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}, ` +
      `risk ${plan.riskTier}` +
      (plan.sourcesConsulted.length > 0
        ? `, grounded in ${plan.sourcesConsulted.length} declared source${plan.sourcesConsulted.length === 1 ? '' : 's'}`
        : ', no sources declared') +
      `\n  construct plan ${started.runId}\n`,
  );
  for (const d of plan.discarded) {
    process.stdout.write(`  discarded: ${d.description} — ${d.reason}\n`);
  }
}

function reportRun(started: StartedRun): void {
  process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
  process.stdout.write(`implicated domains (${started.implicated.length}):\n`);
  for (const implication of started.implicated) {
    process.stdout.write(`  ${implication.domain}  — ${implication.concern}\n`);
    // Named implications carry no keyword score, so reporting one would
    // invite comparison with numbers that mean something else entirely.
    const evidence =
      started.inferredBy === 'keywords'
        ? `signals: ${implication.signals.slice(0, 4).join(', ')} (score ${implication.score})`
        : `reason: ${implication.signals.join(' ')}`;
    process.stdout.write(`      ${evidence}\n`);
  }
  if (started.inferredBy === 'user') {
    process.stdout.write('\nYou named these; nothing was inferred and no model was consulted.\n');
  }
  if (started.inferredBy === 'namer' || started.inferredBy === 'cache') {
    process.stdout.write(
      started.inferredBy === 'cache'
        ? '\nThese came from a model consulted for this outcome earlier, not from keywords.\n'
        : '\nThese came from a model reading the outcome; each reason above is its stated evidence.\n',
    );
  }
  if (started.namerFailure !== undefined) {
    // A keyword answer standing in for a model's is a degradation, and the
    // user hears it here as well as in the log.
    process.stdout.write(
      `\nThe model could not be consulted (${started.namerFailure}); the keyword map answered instead.\n`,
    );
  }
  if (started.namerRetriedAfter !== undefined) {
    // A repaired reply is the model's answer, but it took a second call to
    // get it, and the fragility should not read as a clean first turn.
    process.stdout.write(
      `\nThe model's first reply could not be parsed (${started.namerRetriedAfter}); ` +
        'a corrective retry produced this answer.\n',
    );
  }
  process.stdout.write(
    `\nfiled ${started.logged.length} work log entries and queued ${started.tasks.length} task(s).\n`,
  );
  process.stdout.write(`Run them:  construct work --run ${started.runId}\n`);
  process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
}

/**
 * Record an outcome.
 *
 * Without --host the path is deterministic, does no I/O beyond the store, and
 * costs nothing — the keyword map answers or it does not. With --host, that
 * host's model reads every outcome as the primary namer and the map is only
 * the fallback if the model fails (adopted 2026-08-05 on the
 * RESEARCH-DECISIONS.md §10 figures: on wording the catalog's authors never
 * wrote, the map missed 0.634 where the namer missed 0.301).
 *
 * `hostOverride` exists so the CLI's own wiring is testable without a binary
 * present, exactly as with `work`.
 */
export async function outcome(argv: string[], hostOverride?: HostAdapter): Promise<number> {
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
      reportRun(started);
      planRun(store, started, null, 'default', at);
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
        //: the user, not the tool, decides to spend money.
        process.stdout.write(
          '\nA host model can be asked instead, at cost:\n' +
            `  construct outcome --host=<opencode|claude> ${JSON.stringify(args.text)}\n`,
        );
        planRun(store, started, null, 'default', at);
        return 0;
      }
      reportRun(started);
      planRun(store, started, null, 'default', at);
      return 0;
    }

    const host =
      hostOverride ??
      (args.host === 'claude'
        ? createClaudeAdapter({ binary: args.binary, model: args.model, dir: args.dir })
        : createOpenCodeAdapter({ binary: args.binary, model: args.model, dir: args.dir }));

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
          `intake's first reply could not be parsed (${densified.retriedAfter}); ` +
            'a corrective retry produced this understanding.\n',
        );
      }
      process.stdout.write(`as understood (your words are the record; correct this if it is wrong):\n`);
      process.stdout.write(`  outcome: ${densified.outcome}\n`);
      for (const c of densified.constraints) process.stdout.write(`  constraint: ${c}\n`);
      for (const d of densified.decisions) process.stdout.write(`  decided: ${d}\n`);
      for (const p of densified.parked) process.stdout.write(`  parked: ${p}\n`);
      process.stdout.write('\n');
    } else if (densifyFailure !== undefined) {
      process.stdout.write(
        `the outcome could not be optimized at intake (${densifyFailure}); the raw text is used as given.\n\n`,
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
          ? `no domains implicated. ${host.name} could not be consulted (${started.namerFailure}) ` +
              'and the keyword map is silent too — this is recorded, not silently dropped.\n'
          : `no domains implicated. ${host.name} considered the catalog and named nothing — ` +
              'this is recorded, not silently dropped.\n',
      );
      planRun(store, started, densified, 'default', at);
      return 0;
    }
    reportRun(started);
    planRun(store, started, densified, 'default', at);
    return 0;
  });
}

const NOTES_USAGE =
  'usage: construct notes <file> [--workspace=<name>] [--run=<id>] ' +
  '[--host=<opencode|claude> [--model=…] [--binary=…] [--dir=…]]\n';

export interface NotesArgs {
  readonly file: string;
  readonly workspace: string;
  readonly run?: string;
  readonly host?: 'opencode' | 'claude';
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
}

export function parseNotesArgs(argv: string[]): NotesArgs {
  const flags: Record<string, string> = {};
  const words: string[] = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
    else words.push(arg);
  }
  if (words.length !== 1) {
    throw new Error(words.length === 0 ? 'a notes file is required' : 'one notes file at a time');
  }
  const host = flags.host;
  if (host !== undefined && host !== 'opencode' && host !== 'claude') {
    throw new Error(`unknown host "${host}" (expected opencode or claude)`);
  }
  const hostFlags = ['model', 'binary', 'dir'].filter((f) => flags[f] !== undefined);
  if (host === undefined && hostFlags.length > 0) {
    throw new Error(
      `--${hostFlags[0]} only applies when a host is named; add --host=<opencode|claude>, or drop the flag`,
    );
  }
  return {
    file: words[0] as string,
    workspace: flags.workspace ?? 'default',
    run: flags.run,
    host,
    model: flags.model,
    binary: flags.binary,
    dir: flags.dir,
  };
}

/**
 * Drop after-call notes and, with a host named, run the context loop over
 * them: densify, produce deltas/proposals/observations, challenge each delta
 * adversarially, then apply — deltas through the admission gate, proposals
 * into the rung 0 queue, observations through the citation screen.
 *
 * Without --host, recording is all that happens: the loop is model work, and
 * the free path says so instead of guessing. The note is kept either way —
 * the evidence lands first, and a later pass can always run over it.
 */
export async function notes(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: NotesArgs;
  try {
    args = parseNotesArgs(argv);
  } catch (error) {
    process.stderr.write(`notes: ${(error as Error).message}\n${NOTES_USAGE}`);
    return 2;
  }

  // Source reading goes through the extraction ladder, not a bare byte read:
  // a binary document either extracts through a rung this install can run, or
  // is refused with the ladder's own remediation — garbage bytes recorded as
  // prose is the failure mode this replaces. Docling participates only when
  // the probe says it exists.
  const doclingProbe = probeDocling();
  const sourceRead = readSource(args.file, { docling: doclingProbe });
  if (!sourceRead.ok) {
    process.stderr.write(
      `notes: ${sourceRead.reason}\n` +
        (sourceRead.remediation ? `  ${sourceRead.remediation}\n` : '') +
        `  (docling probe: ${doclingProbe.detail})\n`,
    );
    return withStoreAsync(async (store) => {
      // The refusal and its fallback path reach the record, not just stderr —
      // a run reading its log later must see why this source is absent.
      if (args.run) {
        appendWorkLog(store, {
          run: args.run,
          role: 'intake',
          action: 'extraction-refused',
          detail: {
            file: args.file,
            reason: sourceRead.reason,
            remediation: sourceRead.remediation,
            doclingProbe: doclingProbe.detail,
          },
          at: now(),
        });
      }
      return 1;
    });
  }
  const body: string = sourceRead.text;

  return withStoreAsync(async (store) => {
    const at = now();
    const noteId = `note-${at.replace(/[-:.TZ]/g, '')}`;
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
      process.stderr.write(`notes: ${(error as Error).message}\n`);
      return 1;
    }
    const lineCount = body.split('\n').length;
    process.stdout.write(
      `note ${noteId}: ${lineCount} line${lineCount === 1 ? '' : 's'} recorded verbatim in workspace "${args.workspace}".\n`,
    );

    if (args.host === undefined && hostOverride === undefined) {
      process.stdout.write(
        '\nThe note is kept; drawing conclusions from it is model work, at cost:\n' +
          `  construct notes --host=<opencode|claude> ${args.file}\n`,
      );
      return 0;
    }

    const host =
      hostOverride ??
      (args.host === 'claude'
        ? createClaudeAdapter({ binary: args.binary, model: args.model, dir: args.dir })
        : createOpenCodeAdapter({ binary: args.binary, model: args.model, dir: args.dir }));
    try {
      await host.init();
    } catch (error) {
      process.stderr.write(
        `notes: host "${host.name}" is not available — ${(error as Error).message}. ` +
          'The note is recorded; run the loop again when the host is.\n',
      );
      return 1;
    }

    // Densify first: the confirm-intent summary is a restatement of this
    // reading, and a loop that cannot state its reading has nothing to
    // confirm. The note is already safe, so failing here loses no evidence.
    let densified: DensifiedIntake;
    try {
      densified = await createHostDensifier(host)(body);
    } catch (error) {
      process.stderr.write(
        `notes: the note could not be densified (${(error as Error).message}). ` +
          `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
      );
      return 1;
    }

    const sources = sourcesFor(store, args.workspace);
    let produced: ProducedLoop;
    try {
      const reply = await createHostProducer(host)({
        noteBody: body,
        noteId,
        lessons: operationalLessonsFor(store, args.workspace).map((l) => l.body),
        sources: sources.map((s) => ({ id: s.id, kind: s.kind, locator: s.locator })),
      });
      produced = toProducedLoop(reply, noteId);
    } catch (error) {
      process.stderr.write(
        `notes: the loop could not read the note (${(error as Error).message}). ` +
          `It is recorded as ${noteId}; run the loop again when the host answers.\n`,
      );
      return 1;
    }
    for (const reason of produced.discarded) {
      process.stdout.write(`  discarded: ${reason}\n`);
    }

    // The screen before the gate: a citation that does not resolve, or a
    // proposal against an undeclared source, is dropped here with its reason
    // so one bad item does not abort the pass; the loop's hard gate stays the
    // backstop for anything that slips past.
    const sourceIds = new Set(sources.map((s) => s.id));
    const challenger = createHostChallenger(host);
    const deltas: MemoryDelta[] = [];
    for (const [i, delta] of produced.deltas.entries()) {
      const cited = resolveNoteCitation(store, delta.citation);
      if (!cited) {
        process.stdout.write(
          `  discarded: delta "${delta.body.slice(0, 60)}" cites ${delta.citation}, which is not a line of this note\n`,
        );
        continue;
      }
      let challenge: DeltaChallenge;
      try {
        challenge = await challenger(delta, cited.text);
      } catch (error) {
        process.stdout.write(
          `  held back: delta "${delta.body.slice(0, 60)}" could not be challenged (${(error as Error).message}); an unchallenged delta is not recorded\n`,
        );
        continue;
      }
      if (!challenge.upheld) {
        process.stdout.write(
          `  refuted: delta "${delta.body.slice(0, 60)}" — ${challenge.detail}\n`,
        );
        continue;
      }
      deltas.push({
        id: `${noteId}-d${i + 1}`,
        kind: delta.kind,
        domain: delta.domain,
        body: delta.body,
        citation: delta.citation,
        external: delta.external,
        basis: { kind: 'adversarial-pass', detail: challenge.detail },
      });
    }

    const proposals: PropagationProposal[] = [];
    for (const [i, proposal] of produced.proposals.entries()) {
      if (!sourceIds.has(proposal.source)) {
        process.stdout.write(
          `  discarded: proposal "${proposal.change.slice(0, 60)}" targets ${proposal.source}, which is not a declared source\n`,
        );
        continue;
      }
      if (!resolveNoteCitation(store, proposal.justification)) {
        process.stdout.write(
          `  discarded: proposal "${proposal.change.slice(0, 60)}" cites ${proposal.justification}, which is not a line of this note\n`,
        );
        continue;
      }
      proposals.push({
        id: `${noteId}-p${i + 1}`,
        source: proposal.source,
        change: proposal.change,
        justification: proposal.justification,
        risk: proposal.risk,
      });
    }

    const result = applyContextLoop(
      store,
      {
        workspace: args.workspace,
        run: args.run ?? noteId,
        noteId,
        densified,
        deltas,
        proposals,
      },
      at,
    );

    process.stdout.write(`\n${result.summary}\n`);

    if (result.admissions.length > 0) {
      process.stdout.write('\nmemory deltas (through the admission gate):\n');
      for (const admission of result.admissions) {
        process.stdout.write(`  ${admission.verdict}: ${admission.lesson} — ${admission.reason}\n`);
      }
    }
    if (result.filed.length > 0) {
      process.stdout.write(
        `\nfiled ${result.filed.length} propagation proposal${result.filed.length === 1 ? '' : 's'} — ` +
          'each waits for a decision; nothing was written outward:\n',
      );
      for (const id of result.filed) process.stdout.write(`  ${id}\n`);
    }

    const screened = screenObservations(produced.observations, sources);
    if (screened.flags.length > 0) {
      process.stdout.write('\ncross-source drift:\n');
      for (const flag of screened.flags) {
        process.stdout.write(
          `  ${flag.claim}\n    cites: ${flag.citations.map((c) => `${c.source} ${c.document}`).join('; ')}\n`,
        );
      }
    }
    for (const drop of screened.discarded) {
      process.stdout.write(`  discarded observation: ${drop.observation.claim.slice(0, 60)} — ${drop.reason}\n`);
    }

    return 0;
  });
}

export interface WorkArgs {
  readonly run?: string;
  readonly concurrency: number;
  readonly ceiling: number;
  readonly leaseMinutes: number;
  readonly model?: string;
  readonly binary?: string;
  readonly dir?: string;
  /** Which host executes: 'opencode' (default) or 'claude'. */
  readonly host: string;
  /**
   * Whether --host was actually typed. The default and the recorded choice
   * must be distinguishable, or the recorded choice could never win.
   */
  readonly hostExplicit: boolean;
  /**
   * The user asking for a voice other than Construct's, in their own words.
   * Absent is the house voice — the case that needs no flag and no record.
   */
  readonly voice?: string;
}

/**
 * The ceiling is total spend across every run this machine has recorded, not
 * this invocation's — ten runs of nine dollars is exactly what a per-run cap
 * misses. It is deliberately low enough to be hit, since a ceiling nobody ever
 * reaches has never been tested.
 */
export const DEFAULT_SPEND_CEILING = 10;

export function parseWorkArgs(argv: string[]): WorkArgs {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  const runIndex = argv.indexOf('--run');
  const run = args.run ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined);

  const number = (name: string, fallback: number): number => {
    if (args[name] === undefined) return fallback;
    const value = Number(args[name]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid --${name}=${args[name]}; expected a non-negative number`);
    }
    return value;
  };

  const host = args.host ?? 'opencode';
  if (host !== 'opencode' && host !== 'claude') {
    throw new Error(`Invalid --host=${host}; expected opencode|claude`);
  }

  return {
    run,
    concurrency: number('concurrency', DEFAULT_CONCURRENCY),
    ceiling: number('ceiling', DEFAULT_SPEND_CEILING),
    leaseMinutes: number('lease-minutes', 15),
    model: args.model,
    binary: args.binary,
    dir: args.dir,
    host,
    hostExplicit: args.host !== undefined,
    voice: args.voice?.trim() ? args.voice.trim() : undefined,
  };
}

function money(amount: number): string {
  return amount === 0 ? '0' : amount.toFixed(amount < 0.01 ? 5 : 2);
}

/**
 * Why a task failed, in one line. A failed task has no cost to report, and
 * saying "cost not reported" there tells the user nothing about the thing that
 * actually went wrong.
 */
function failureLine(error: unknown): string {
  const record = error as { messages?: unknown; message?: unknown } | null;
  const first = Array.isArray(record?.messages) ? record.messages[0] : record?.message;
  return typeof first === 'string' && first ? first : 'failed';
}

/**
 * What to say when an attempt to work produced no deliverable at all.
 *
 * An earlier fix established the substance of this and it is unchanged: a failed
 * task is terminal, the host owns retries (commitment 1), and nothing here is a
 * retry policy. What it got wrong was reachability. The text lived only on the
 * nothing-left-to-work path, so it printed on a SECOND `construct work` against
 * an already-settled run — and the output of the first gave nobody a reason to
 * run a second (found in a live run whose every task failed with
 * "Missing Authentication header" and said nothing further).
 *
 * So it is one writer called from both places rather than two copies that drift.
 */
function writeTotalFailureRecourse(failedCount: number): void {
  process.stdout.write(
    `\nAll ${String(failedCount)} task(s) failed and produced no deliverable.\n` +
      'A failed task is terminal — the host owns retries, so re-running work will not pick these up.\n' +
      'If the cause was the dispatch rather than the work (an unresolvable --model, a host that was ' +
      'not reachable, a missing credential), fix it and file the outcome again:\n' +
      '  construct outcome "<what you want>"\n',
  );
}

/**
 * Dispatch the queued tasks to a host. `hostOverride` exists so the CLI's own
 * wiring can be tested without a binary present; production callers never pass
 * it, exactly as with cleanup's spawn override.
 */
export async function work(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  let args: WorkArgs;
  try {
    args = parseWorkArgs(argv);
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

    const host =
      hostOverride ??
      (hostName === 'claude'
        ? createClaudeAdapter({ binary, model, dir })
        : createOpenCodeAdapter({ binary, model, dir }));

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
          process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${failureLine(task.error)}\n`);
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

    // The producer half of grounding, run before any dispatch: what each run's
    // declared sources actually hold is surveyed and recorded, so materialFor
    // answers the coordinator from evidence rather than from silence. Once per
    // run — the record is evidence, not a cache — and a run whose plan
    // declared no sources is left exactly as it was.
    const pendingRuns = new Set(
      listTasks(store, args.run)
        .filter((t) => t.state === 'pending')
        .map((t) => t.run),
    );
    for (const runId of pendingRuns) {
      const plan = planFor(store, runId);
      if (!plan || plan.sourcesConsulted.length === 0) continue;
      const surveys: SourceSurvey[] = [];
      for (const id of plan.sourcesConsulted) {
        const declared = getSource(store, id);
        if (declared) surveys.push(surveySource(declared));
      }
      const { recorded, skipped } = recordRunSourceReads(store, runId, surveys, now());
      if (skipped) continue;
      const unreachable = surveys.filter((s) => s.outcome === 'unreachable').length;
      const documents = surveys.reduce(
        (sum, s) => sum + (s.outcome === 'listed' ? s.documents.length : 0),
        0,
      );
      appendWorkLog(store, {
        run: runId,
        role: 'construct',
        action: 'sources-read',
        detail: { sources: surveys.length, documents, unreachable, reads: recorded },
        at: now(),
      });
      process.stdout.write(
        `grounded ${runId}: ${String(documents)} document${documents === 1 ? '' : 's'} ` +
          `from ${String(surveys.length)} source${surveys.length === 1 ? '' : 's'}` +
          (unreachable > 0 ? ` (${String(unreachable)} unreachable)` : '') +
          '\n',
      );
    }

    try {
      await host.init();
    } catch (error) {
      // A host that cannot start must never read as a run with nothing to do.
      process.stderr.write(`work: host "${host.name}" is not available — ${(error as Error).message}\n`);
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
      ...(args.voice ? { voice: { instruction: args.voice, source: 'cli --voice' } } : {}),
    });


    process.stdout.write(
      `worked ${String(report.dispatched)} task(s) on ${host.name}: ` +
        `${String(report.completed)} done, ${String(report.failed)} failed.\n`,
    );
    // Only what this invocation settled. Listing everything settled in the
    // store would report a second run's work as this one's.
    for (const id of report.settled) {
      const task = getTask(store, id);
      if (!task) continue;
      if (task.state === 'failed') {
        process.stdout.write(`  ✗ ${task.role.padEnd(20)} ${failureLine(task.error)}\n`);
        continue;
      }
      const cost = task.spendReported ? `$${money(task.spend)}` : 'cost not reported';
      process.stdout.write(`  ✓ ${task.role.padEnd(20)} ${cost}\n`);

      // The two lines a user has to see: what is wrong with this deliverable,
      // and whether anyone is allowed to rely on it as it stands.
      for (const concern of deliverableConcerns(task.result)) {
        process.stdout.write(`      ⚑ ${concern.detail}\n`);
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
      process.stdout.write(`\nissues across roles (${String(merged.length)}, merged lexically):\n`);
      for (const [index, issue] of merged.entries()) {
        process.stdout.write(`  ${String(index + 1)}. [${issue.roles.join(', ')}] ${issue.text}\n`);
      }
    }

    // "spend 0 of 10.00 ceiling" after a run where nothing completed reads as
    // "this was cheap" when the true statement is that nothing ran. The
    // costSilent branch below does not cover it: these tasks failed rather than
    // completing without reporting a cost.
    if (report.completed === 0 && report.failed > 0) {
      writeTotalFailureRecourse(report.failed);
    } else {
      process.stdout.write(
        `\nspend ${money(report.spendAfter)} of ${money(report.spendCeiling)} ceiling.\n`,
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
        `\nhalted: spend ceiling reached. ${String(left)} task(s) left pending — ` +
          'raise it with --ceiling=<amount> to continue.\n',
      );
      return 1;
    }
    return report.failed > 0 ? 1 : 0;
  });
}

/**
 * How an entry's inference was reached, when that is not the free default
 *. Keyword inferences stay unannotated so the log does not grow
 * a column that says "normal" on almost every line; an entry that cost a model
 * call says so, because reading the log is how a user audits what was spent and
 * what an inference actually rests on.
 */
function howInferred(detail: unknown): string {
  const inferredBy = (detail as { inferredBy?: unknown } | null)?.inferredBy;
  if (inferredBy === 'namer') return '  (inferred by: namer — a model read the outcome)';
  if (inferredBy === 'cache') return '  (inferred by: cache — an earlier consultation for this outcome)';
  if (inferredBy === 'user') return '  (named by: the user — not inferred)';
  return '';
}

/**
 * The recorded reason on entries that carry one. The store holds the whole
 * detail; a failure or degradation line that reads as a bare action name
 * defeats the append-only record — the reason survived only in the terminal
 * that produced it. This stays a clause on the known reason-bearing kinds,
 * not a general detail dump: the log keeps one line per entry.
 */
export function reasonClause(action: string, detail: unknown): string {
  const d = detail as Record<string, unknown> | null;
  const s = (key: string): string | undefined =>
    typeof d?.[key] === 'string' && (d[key] as string).trim() !== '' ? (d[key] as string) : undefined;
  switch (action) {
    case 'namer-failed': {
      const failure = s('failure') ?? 'reason not recorded';
      const fellBackTo = s('fellBackTo');
      return `  — ${failure}${fellBackTo ? `; fell back to ${fellBackTo}` : ''}`;
    }
    case 'namer-retried':
      return `  — first reply failed (${s('firstFailure') ?? 'unparseable'}); a corrective retry answered`;
    case 'model-untuned-best-effort':
      return `  — ${s('model') ?? 'model unknown'}: no tuning evidence for this family; output is best-effort`;
    case 'model-floor-degraded':
      return `  — ${s('why') ?? 'reason not recorded'}`;
    case 'extraction-refused':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'role-failed':
      return `  — ${s('error') ?? s('status') ?? 'reason not recorded'}`;
    case 'dispatch-halted':
      return `  — ${s('reason') ?? 'reason not recorded'}`;
    case 'voice-overridden':
      return `  — ${s('instruction') ?? 'instruction not recorded'}`;
    default:
      return '';
  }
}

/**
 * Render a submitted deliverable for reading. A string is the text itself; an
 * object with a `text` field was a role wrapping its prose; anything else is
 * shown as formatted JSON rather than hidden.
 */
function renderDeliverable(deliverable: unknown): string {
  if (typeof deliverable === 'string') return deliverable;
  const text = (deliverable as { text?: unknown } | null)?.text;
  if (typeof text === 'string') return text;
  return JSON.stringify(deliverable, null, 2);
}

/**
 * The deliverable is the product, and until this command existed no surface
 * showed it: `work` reported "done" with the cost, `log` reported action
 * names, and the text a user paid for sat in the store readable only by hand.
 * A spine that ends at "done" without showing the work is missing its last
 * step.
 */
export function show(argv: string[]): number {
  const runIndex = argv.indexOf('--run');
  const run = argv.find((a) => a.startsWith('--run='))?.slice('--run='.length)
    ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined);
  if (!run) {
    process.stderr.write('usage: construct show --run <id>\n');
    return 2;
  }

  return withStore((store) => {
    const tasks = listTasks(store, run);
    if (tasks.length === 0) {
      process.stdout.write(`no tasks for ${run}. Record an outcome first: construct outcome "<what you want>"\n`);
      return 0;
    }
    for (const task of tasks) {
      const draft = latestDraft(store, task.id);
      const promotion = promotionOf(store, task.id);
      process.stdout.write(`\n${task.role} — ${task.state}`);
      if (promotion) process.stdout.write(` · ${promotion.state}`);
      const review = licensedReviewFor(task.role);
      if (review) {
        process.stdout.write(
          `\n  issue-spotting only: needs review by a licensed ${review} before you rely on it`,
        );
      }
      process.stdout.write('\n');
      // A draft submitted through the write surface is the deliverable of
      // record; a role whose host has no write-through leaves its reply in the
      // task result, and showing nothing there would hide real work.
      const deliverable = draft?.deliverable ?? task.result;
      if (deliverable === null || deliverable === undefined) {
        process.stdout.write('  (no deliverable was produced for this task)\n');
        continue;
      }
      if (!draft) process.stdout.write('  (from the role\'s reply; no draft was submitted)\n');
      const body = renderDeliverable(deliverable)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');
      process.stdout.write(`${body}\n`);
    }
    return 0;
  });
}

export function log(argv: string[]): number {
  const runIndex = argv.indexOf('--run');
  const run = runIndex >= 0 ? argv[runIndex + 1] : undefined;

  return withStore((store) => {
    const entries = readWorkLog(store, run);
    if (entries.length === 0) {
      process.stdout.write(run ? `no work log entries for ${run}\n` : 'work log is empty\n');
      return 0;
    }
    for (const entry of entries) {
      process.stdout.write(
        `${String(entry.seq).padStart(4)}  ${entry.at}  ${entry.role}  ${entry.action}` +
          `${howInferred(entry.detail)}${reasonClause(entry.action, entry.detail)}\n`,
      );
    }
    process.stdout.write(`\n${entries.length} entries (append-only).\n`);
    writeRunState(store, run);
    return 0;
  });
}

/**
 * Where a run currently stands, under the event stream.
 *
 * The defect this closes: a run in flight and a run that died end at the SAME
 * log line. A failed task writes no event past `capability-issued`, and neither
 * does a task that is still executing — so the two are indistinguishable from
 * the stream alone. Found on a live, healthy run that was reasonably read as
 * hung, where telling them apart meant opening construct.db by hand.
 *
 * Why this lives on `log` rather than a new `construct status` verb. The user
 * whose confusion produced the bead reached for `construct log`, so answering
 * anywhere else costs a discovery step at exactly the moment someone is unsure
 * whether their run is broken. It also honours the project's preference for
 * extending an existing surface over adding one.
 *
 * The stream itself is untouched and stays append-only: this is a footer that
 * reads current task state, clearly separated from the events above it. Nothing
 * here mutates, and nothing polls — it is one read of what the store already
 * holds, which is the whole reason the CLI could have said it all along.
 */
function writeRunState(store: Store, run?: string): void {
  const tasks = listTasks(store, run);
  if (tasks.length === 0) return;

  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1);

  const parts = [...counts.entries()].map(([state, n]) => `${String(n)} ${state}`);
  process.stdout.write(`${tasks.length} task(s): ${parts.join(', ')}.\n`);

  // A lease with time left is the one fact that separates "still working" from
  // "stopped", and it is the fact nobody could see. Report the deadline rather
  // than a remaining-time countdown, so the line does not imply it is watching.
  const running = tasks.filter((t) => t.state === 'leased' && t.leaseUntil);
  if (running.length > 0) {
    const latest = running
      .map((t) => t.leaseUntil as string)
      .reduce((a, b) => (a > b ? a : b));
    process.stdout.write(
      `Still running — ${String(running.length)} task(s) hold a lease until ${latest}. ` +
        'Re-read this log rather than re-running work; work will not take a live lease.\n',
    );
    return;
  }

  const failed = tasks.filter((t) => t.state === 'failed');
  if (failed.length > 0 && failed.length === tasks.length) {
    writeTotalFailureRecourse(failed.length);
  } else if (failed.length > 0) {
    process.stdout.write(
      `${String(failed.length)} task(s) failed and produced no deliverable; their errors are above.\n`,
    );
  }
}

export function inbox(): number {
  return withStore((store) => {
    const open = openDecisions(store);
    if (open.length === 0) {
      process.stdout.write('decision inbox: empty. Nothing needs you right now.\n');
      return 0;
    }
    process.stdout.write(`decision inbox (${open.length}):\n\n`);
    for (const decision of open) {
      process.stdout.write(`  ${decision.id}  ${decision.question}\n`);
      for (const position of decision.positions) {
        const cited = position.citation ? ` [${position.citation}]` : ' [unverified]';
        process.stdout.write(`      ${position.role}: ${position.stance}${cited}\n`);
      }
      process.stdout.write('\n');
    }
    process.stdout.write('Resolve with: construct decide <id> "<your call>"\n');
    return 0;
  });
}

export function decide(argv: string[]): number {
  const [id, ...rest] = argv;
  const resolution = rest.join(' ').trim();
  if (!id || !resolution) {
    process.stderr.write('usage: construct decide <id> "<your call>"\n');
    return 2;
  }
  return withStore((store) => {
    try {
      resolveDecision(store, id, resolution, now());
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`decided ${id}: ${resolution}\n`);
    return 0;
  });
}

export interface VerdictArgs {
  readonly run?: string;
  readonly confirm: readonly string[];
  readonly dismiss: readonly string[];
  readonly missed: readonly string[];
  readonly source: string;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseVerdictArgs(argv: string[]): VerdictArgs {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  // `--run <id>` as well as `--run=<id>`, because `log` and `work` both take
  // the spaced form and a user who learned it there types it here. This
  // surface refusing it sent people to a usage error at the one step the
  // routing corpus depends on.
  const runIndex = argv.indexOf('--run');
  return {
    run: args.run ?? (runIndex >= 0 ? argv[runIndex + 1] : undefined),
    confirm: args.confirm ? splitList(args.confirm) : [],
    dismiss: args.dismiss ? splitList(args.dismiss) : [],
    missed: args.missed ? splitList(args.missed) : [],
    source: args.source ?? 'user',
  };
}

/**
 * The CLI verdict surface: what confirms, dismisses, or
 * names a felt absence for the domains one run surfaced. Named `verdict`
 * rather than reusing `work` — that name already belongs to dispatching tasks
 * to a host — but it is exactly the surface the bead describes: list what
 * surfaced, let the user confirm or dismiss it, and give the ambush (a domain
 * that never surfaced but should have) a way to be recorded too.
 */
export function verdict(argv: string[]): number {
  let args: VerdictArgs;
  try {
    args = parseVerdictArgs(argv);
  } catch (error) {
    process.stderr.write(`verdict: ${(error as Error).message}\n`);
    return 2;
  }
  if (!args.run) {
    process.stderr.write('usage: construct verdict --run=<id> [--confirm=d1,d2] [--dismiss=d3] [--missed=d4] [--source=<name>]\n');
    return 2;
  }
  const run = args.run;

  return withStore((store) => {
    const surfaced = surfacedDomains(store, run);
    const outcomeText = runOutcomeText(store, run);
    if (outcomeText === null) {
      process.stderr.write(`verdict: no recorded outcome for run ${run}\n`);
      return 1;
    }

    if (args.confirm.length === 0 && args.dismiss.length === 0 && args.missed.length === 0) {
      // Nothing to record: show what there is to render a verdict on.
      process.stdout.write(`run ${run}\n  outcome: ${outcomeText}\n\n`);
      if (surfaced.length === 0) {
        process.stdout.write('no domains surfaced for this run.\n');
      } else {
        process.stdout.write(`surfaced domains (${surfaced.length}):\n`);
        for (const domain of surfaced) process.stdout.write(`  ${domain}\n`);
      }
      process.stdout.write(
        '\nRecord a verdict:\n' +
          `  construct verdict --run=${run} --confirm=<domain,...>   it was right to surface these\n` +
          `  construct verdict --run=${run} --dismiss=<domain,...>   it was wrong to surface these\n` +
          `  construct verdict --run=${run} --missed=<domain,...>    these should have surfaced and did not\n`,
      );
      return 0;
    }

    let recorded: RecordedVerdict;
    try {
      recorded = recordVerdict(store, {
        run,
        confirm: args.confirm,
        dismiss: args.dismiss,
        missed: args.missed,
        source: args.source,
        at: now(),
      });
    } catch (error) {
      const hint =
        error instanceof UnsurfacedVerdictError
          ? ` Use --missed=${error.domains.join(',')} for a felt absence.`
          : '';
      process.stderr.write(`verdict: ${(error as Error).message}${hint}\n`);
      return 2;
    }

    process.stdout.write(
      `recorded verdict #${String(recorded.seq)} for ${run}: ` +
        `${String(recorded.confirmed)} confirmed, ${String(recorded.dismissed)} dismissed, ` +
        `${String(recorded.missed)} missed.\n`,
    );
    return 0;
  });
}

/**
 * Write the harvested corpus (every recorded verdict, folded through
 * `harvestCorpus`) to `path`, fixture-shaped exactly as map.test.ts consumes
 * it. This is the export path corpus expansion reads from.
 */
export function corpusExport(argv: string[]): number {
  const path = argv[0];
  if (!path) {
    process.stderr.write('usage: construct corpus export <path>\n');
    return 2;
  }
  return withStore((store) => {
    const history = readFeedback(store);
    const corpus = harvestCorpus(history);
    writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
    process.stdout.write(
      `wrote ${String(corpus.outcomes.length)} outcome(s) to ${path} ` +
        `(${String(corpus.skipped)} verdict-free record(s) skipped).\n`,
    );
    return 0;
  });
}

export function corpus(argv: string[]): number {
  const [sub, ...rest] = argv;
  if (sub === 'export') return corpusExport(rest);
  process.stderr.write('usage: construct corpus export <path>\n');
  return 2;
}


const WATCH_USAGE =
  'usage: construct watch [--root=<repo>] [--sweep]\n';

/**
 * The standing watch, swept once.
 *
 * A watch is an outcome that never closes, so there is no "start" to run and
 * nothing to schedule: something outside decides when to look, exactly as
 * something outside decides when to `work`. Today the only ground is Construct
 * itself (commitment 16 made operational), which is why this takes a repo root
 * and nothing else. External ground waits for Phase 4 behind its gates.
 */
export function watch(argv: string[]): number {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? '';
  }
  if (flags.help !== undefined) {
    process.stdout.write(WATCH_USAGE);
    return 0;
  }
  const root = flags.root || process.cwd();

  const gathered = gatherRepoEvidence({ root });
  if (isFailure(gathered)) {
    // Nothing to watch is not a failure of the watch; it is a fact about the
    // ground, and saying which is the difference between a broken tool and an
    // unwatched repository.
    process.stderr.write(`watch: ${gathered.problem}\n`);
    return 1;
  }

  const at = now();
  const report = reconcileSession(gathered.issues, gathered.evidence, at);
  const findings = constructFindings(report);
  const target: Watch = { id: 'construct', ground: CONSTRUCT_GROUND };

  return withStore((store) => {
    if (readWorkLog(store, watchRun(target)).length === 0) startWatch(store, target, at);
    const result = sweepWatch(store, { watch: target, findings, at });

    process.stdout.write(`watch ${target.id}\n  ground: ${target.ground}\n\n`);
    if (findings.length === 0) {
      process.stdout.write('nothing diverged. The tracker and the repo agree.\n');
      return 0;
    }
    process.stdout.write(
      `${String(findings.length)} finding(s): ` +
        `${String(result.raised.length)} raised as new decisions, ` +
        `${String(result.standing.length)} already standing.\n`,
    );
    for (const key of result.raised) process.stdout.write(`  new       ${key}\n`);
    for (const key of result.standing) process.stdout.write(`  standing  ${key}\n`);
    if (result.raised.length > 0) {
      process.stdout.write('\nRead them:  construct inbox\n');
    } else {
      // A sweep that raises nothing new is the common case, and it must not
      // read as a sweep that found nothing.
      process.stdout.write(
        '\nEverything found is already in the inbox, unresolved. A standing finding is\n' +
          'not raised twice; resolve it with: construct decide --id=<id> --resolution="..."\n',
      );
    }
    return 0;
  });
}


const WAIVE_USAGE =
  'usage: construct waive --task=<id> --challenge=<id> --reason="<why>"\n';

/**
 * Set one challenge aside, on one deliverable.
 *
 * There is deliberately no --all, no config key, and no way to waive a
 * challenge for future work: commitment 13 puts waivers with the user alone,
 * per deliverable and per challenge, and a waiver that outlives the deliverable
 * it was granted for is the global off-switch that commitment forbids.
 */
export function waive(argv: string[]): number {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
  }
  const task = flags.task;
  const challenge = flags.challenge;
  const reason = flags.reason ?? '';
  if (!task || !challenge) {
    process.stderr.write(WAIVE_USAGE);
    return 2;
  }

  return withStore((store) => {
    const record = waiveChallenge(store, {
      task,
      challenge,
      // The waiver is the user's, and the record says so rather than letting it
      // read as something the system decided.
      by: 'user',
      reason,
      at: now(),
    });
    if (!record.recorded) {
      process.stderr.write(`waive: ${record.reason ?? 'refused'}\n`);
      return record.refusal === 'unknown-task' ? 1 : 2;
    }
    const promotion = promotionOf(store, task);
    process.stdout.write(`waived ${challenge} on ${task}: ${reason}\n`);
    if (promotion) {
      process.stdout.write(
        `  ${task} is now ${promotion.state}` +
          (promotion.waived.length > 0 ? ` (waived: ${promotion.waived.join(', ')})` : '') +
          '\n',
      );
    }
    return 0;
  });
}

const SOURCE_USAGE =
  'usage: construct source add --kind=<directory|git|github|jira|docs> --locator=<where> [--workspace=<name>]\n' +
  '       construct source list [--workspace=<name>] [--all]\n' +
  '       construct source retire --id=<source-id>\n';

const MODE_USAGE = 'usage: construct mode [--workspace=<name>] [--set=<team|seat>]\n';

const PLAN_USAGE = 'usage: construct plan <run-id>\n';

/**
 * Render a run's recorded plan: the understanding it worked from, its risk
 * tier, the steps with their playbook routing and deliverable slots, and anything
 * the planner discarded for fabricated provenance. Read-only: the plan is
 * write-once at outcome time, so this command shows, never edits.
 */
export function plan(argv: string[]): number {
  const runId = argv[0];
  if (!runId || runId.startsWith('--')) {
    process.stderr.write(PLAN_USAGE);
    return 2;
  }
  return withStore((store) => {
    const found = planFor(store, runId);
    if (!found) {
      process.stderr.write(`plan: no plan recorded for ${runId}\n`);
      return 1;
    }
    process.stdout.write(`plan ${found.id} (run ${found.run}, ${found.plannedAt})\n`);
    process.stdout.write(`  outcome: ${found.outcome}\n`);
    process.stdout.write(`  understood as: ${found.understanding.restated}\n`);
    for (const c of found.understanding.constraints) process.stdout.write(`  constraint: ${c}\n`);
    for (const d of found.understanding.decisions) process.stdout.write(`  decided: ${d}\n`);
    for (const p of found.understanding.parked) process.stdout.write(`  parked: ${p}\n`);
    process.stdout.write(`  risk: ${found.riskTier}  mode: ${found.mode}\n`);
    process.stdout.write(
      found.sourcesConsulted.length > 0
        ? `  sources: ${found.sourcesConsulted.join(', ')}\n`
        : '  sources: none declared\n',
    );
    if (found.steps.length === 0) {
      process.stdout.write('  steps: none — nothing was implicated\n');
    }
    for (const step of found.steps) {
      const route = found.routing.find((r) => r.step === step.id);
      process.stdout.write(`\n  ${step.id}  ${step.description}\n`);
      process.stdout.write(
        `    routed to ${step.domain} by ${route?.routedBy ?? 'unknown'}` +
          (route && route.evidence.length > 0 ? ` (${route.evidence.slice(0, 4).join(', ')})` : '') +
          '\n',
      );
      process.stdout.write(`    stage: ${step.stage}  deliverable: ${step.deliverable.deliverable}\n`);
      const required = step.deliverable.slots.filter((s) => s.required).map((s) => s.name);
      process.stdout.write(`    required slots: ${required.join(', ')}\n`);
      if (step.after.length > 0) process.stdout.write(`    after: ${step.after.join(', ')}\n`);
    }
    for (const d of found.discarded) {
      process.stdout.write(`\n  discarded: ${d.description} — ${d.reason}\n`);
    }
    return 0;
  });
}

/**
 * Sources and mode default to the "default" workspace rather than inferring
 * one from the directory: an inferred workspace that guessed wrong would file
 * one client's sources under another, which is the exact failure the lesson
 * store was rebuilt to make unrepresentable. Naming a workspace is cheap;
 * un-crossing two is not.
 */
function workspaceFlag(flags: Record<string, string>): string {
  return flags.workspace?.trim() || 'default';
}

function parseFlags(argv: string[]): { flags: Record<string, string>; rest: string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (match) flags[match[1]] = match[2] ?? 'true';
    else rest.push(arg);
  }
  return { flags, rest };
}

/**
 * Declare, list, and retire the sources a workspace works from. Declaring
 * builds no connector and reads nothing: it names where organizational
 * context lives so a run can be held to what it actually read from there
 * (the provenance rows), and so an outward write can name its target.
 */
export function source(argv: string[]): number {
  const sub = argv[0];
  const { flags } = parseFlags(argv.slice(1));
  const workspace = workspaceFlag(flags);

  if (sub === 'add') {
    const kind = flags.kind ?? '';
    const locator = flags.locator ?? '';
    if (!(SOURCE_KINDS as readonly string[]).includes(kind) || locator.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      const at = now();
      const id = `src-${at.replace(/[-:.TZ]/g, '')}`;
      try {
        addSource(store, { id, workspace, kind: kind as SourceKind, locator, addedAt: at });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE/i.test(message)) {
          process.stderr.write(
            `source: ${workspace} already declares ${kind} ${locator} — retire the old declaration first if it moved\n`,
          );
          return 1;
        }
        throw error;
      }
      process.stdout.write(`declared ${id}: ${kind} ${locator} (workspace ${workspace})\n`);
      return 0;
    });
  }

  if (sub === 'list') {
    return withStore((store) => {
      const rows = sourcesFor(store, workspace, { includeRetired: flags.all === 'true' });
      if (rows.length === 0) {
        process.stdout.write(`no sources declared for workspace ${workspace}\n`);
        return 0;
      }
      for (const row of rows) {
        process.stdout.write(
          `${row.id}  ${row.kind}  ${row.locator}` +
            (row.retiredAt ? `  (retired ${row.retiredAt})` : '') +
            '\n',
        );
      }
      return 0;
    });
  }

  if (sub === 'retire') {
    const id = flags.id ?? '';
    if (id.trim() === '') {
      process.stderr.write(SOURCE_USAGE);
      return 2;
    }
    return withStore((store) => {
      try {
        retireSource(store, id, now());
      } catch (error) {
        process.stderr.write(`source: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
      process.stdout.write(`retired ${id}\n`);
      return 0;
    });
  }

  process.stderr.write(SOURCE_USAGE);
  return 2;
}

/**
 * Show or set how a workspace engages: `team` (Construct is the whole team,
 * work tracked its own way) or `seat` (it fills one role on a human team and
 * works inside their tracker). Downstream consent postures read this, so it
 * is a declared setting rather than something inferred from usage.
 */
export function mode(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const workspace = workspaceFlag(flags);
  return withStore((store) => {
    if (flags.set !== undefined) {
      if (!(ENGAGEMENT_MODES as readonly string[]).includes(flags.set)) {
        process.stderr.write(MODE_USAGE);
        return 2;
      }
      setEngagementMode(store, workspace, flags.set as EngagementMode, now());
    }
    const current = engagementMode(store, workspace);
    process.stdout.write(
      `workspace ${workspace}: ${current}` +
        (current === 'team'
          ? ' (Construct is the whole team)\n'
          : ' (Construct fills one role on your team)\n'),
    );
    return 0;
  });
}

const USAGE = 'usage: construct <outcome|work|notes|show|plan|source|mode|watch|waive|verdict|corpus|log|inbox|decide|serve|doctor|cleanup|version>\n';

/**
 * Async because `work` dispatches to a host, and `outcome --host=…` may
 * consult one. The other commands stay synchronous — awaiting a number costs
 * nothing and keeps one entry point.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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
    case 'notes':
      return notes(argv.slice(1));
    case 'outcome':
      return outcome(argv.slice(1));
    case 'work':
      return work(argv.slice(1));
    case 'watch':
      return watch(argv.slice(1));
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
    case 'mode':
      return mode(argv.slice(1));
    case 'inbox':
      return inbox();
    case 'decide':
      return decide(argv.slice(1));
    case 'serve':
      return serve();
    case 'role-serve':
      return roleServe();
    case 'doctor':
      return doctor();
    case 'cleanup':
      return cleanup(argv.slice(1));
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
