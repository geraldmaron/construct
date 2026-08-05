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
import { readWorkLog } from '../kernel/store/worklog.ts';
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
import { join } from 'node:path';

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
        return 0;
      }
      reportRun(started);
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

    const started = await startRunNamed(store, {
      runId,
      outcome: args.text,
      at,
      host: host.name,
      namer: createHostNamer(host),
      cache: storeNamingCache(store, { host: host.name, at }),
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
      return 0;
    }
    reportRun(started);
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

  const host =
    hostOverride ??
    (args.host === 'claude'
      ? createClaudeAdapter({ binary: args.binary, model: args.model, dir: args.dir })
      : createOpenCodeAdapter({ binary: args.binary, model: args.model, dir: args.dir }));

  return withStoreAsync(async (store) => {
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
        `${String(entry.seq).padStart(4)}  ${entry.at}  ${entry.role}  ${entry.action}${howInferred(entry.detail)}\n`,
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
  return {
    run: args.run,
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

const USAGE = 'usage: construct <outcome|work|verdict|corpus|log|inbox|decide|serve|doctor|cleanup|version>\n';

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
    case 'outcome':
      return outcome(argv.slice(1));
    case 'work':
      return work(argv.slice(1));
    case 'verdict':
      return verdict(argv.slice(1));
    case 'corpus':
      return corpus(argv.slice(1));
    case 'log':
      return log(argv.slice(1));
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
      return 0;
    default:
      process.stdout.write(USAGE);
      return command === 'help' ? 0 : 1;
  }
}
