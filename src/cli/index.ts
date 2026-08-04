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
import { openStore, storePath, storeWriteProblem, StoreUnavailableError } from '../kernel/store/open.ts';
import type { Store } from '../kernel/store/open.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import { openDecisions, resolveDecision } from '../kernel/store/decisions.ts';
import { countTasksByState, getTask } from '../kernel/store/tasks.ts';
import { startRun } from '../kernel/run/outcome.ts';
import { DEFAULT_CONCURRENCY, workRun } from '../kernel/run/coordinator.ts';
import { deliverableConcerns, licensedReviewFor } from '../kernel/run/accountability.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { createOpenCodeAdapter } from '../hosts/opencode/adapter.ts';

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
    for (const item of detected) {
      const mark = item.risk === 'auto' ? '✓' : '◐';
      process.stdout.write(`  ${mark} ${item.label}\n      ${item.describe()}\n`);
    }
    process.stdout.write('\nPass --yes to remove ✓ items, --yes --all to also remove ◐ items.\n');
    return 0;
  }

  if (!args.yes) {
    process.stderr.write('cleanup: pass --dry-run to preview, or --yes (optionally --all) to apply.\n');
    return 2;
  }

  const toRemove = selectedItems(detected, args.all);
  const result = applyCleanup(detected, new Set(toRemove.map((item) => item.id)));
  for (const outcome of result.removed) {
    process.stdout.write(`  ✓ ${outcome.label} — ${outcome.detail}\n`);
  }
  process.stdout.write(`\ncleanup: removed ${result.removed.length}, skipped ${result.skipped.length}.\n`);
  return result.removed.some((o) => o.detail.startsWith('error:')) ? 1 : 0;
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

export function outcome(argv: string[]): number {
  const text = argv.join(' ').trim();
  if (!text) {
    process.stderr.write('usage: construct outcome "<what you want to happen>"\n');
    return 2;
  }

  return withStore((store) => {
    const at = now();
    const runId = `run-${at.replace(/[-:.TZ]/g, '')}`;
    const started = startRun(store, { runId, outcome: text, at });

    process.stdout.write(`run ${started.runId}\n  outcome: ${started.outcome}\n\n`);
    if (started.implicated.length === 0) {
      process.stdout.write(
        'no domains implicated. Nothing was inferred — this is recorded, not silently dropped.\n',
      );
      return 0;
    }

    process.stdout.write(`implicated domains (${started.implicated.length}):\n`);
    for (const implication of started.implicated) {
      process.stdout.write(`  ${implication.domain}  — ${implication.concern}\n`);
      process.stdout.write(
        `      signals: ${implication.signals.slice(0, 4).join(', ')} (score ${implication.score})\n`,
      );
    }
    process.stdout.write(
      `\nfiled ${started.logged.length} work log entries and queued ${started.tasks.length} task(s).\n`,
    );
    process.stdout.write(`Run them:  construct work --run ${started.runId}\n`);
    process.stdout.write(`Read back: construct log --run ${started.runId}\n`);
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

  return {
    run,
    concurrency: number('concurrency', DEFAULT_CONCURRENCY),
    ceiling: number('ceiling', DEFAULT_SPEND_CEILING),
    leaseMinutes: number('lease-minutes', 15),
    model: args.model,
    binary: args.binary,
    dir: args.dir,
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
    createOpenCodeAdapter({ binary: args.binary, model: args.model, dir: args.dir });

  return withStoreAsync(async (store) => {
    const waiting = countTasksByState(store, args.run).pending ?? 0;
    if (waiting === 0) {
      process.stdout.write(
        args.run
          ? `nothing to work for ${args.run}. Its tasks are already settled.\n`
          : 'nothing to work. Record an outcome first: construct outcome "<what you want>"\n',
      );
      return 0;
    }

    try {
      await host.init();
    } catch (error) {
      // A host that cannot start must never read as a run with nothing to do.
      process.stderr.write(`work: host "${host.name}" is not available — ${(error as Error).message}\n`);
      return 1;
    }

    const report = await workRun(store, host, {
      owner: `cli-${String(process.pid)}`,
      clock: now,
      spendCeiling: args.ceiling,
      concurrency: args.concurrency,
      leaseMs: args.leaseMinutes * 60 * 1000,
      run: args.run,
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

    process.stdout.write(
      `\nspend ${money(report.spendAfter)} of ${money(report.spendCeiling)} ceiling.\n`,
    );
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
      process.stdout.write(`${String(entry.seq).padStart(4)}  ${entry.at}  ${entry.role}  ${entry.action}\n`);
    }
    process.stdout.write(`\n${entries.length} entries (append-only).\n`);
    return 0;
  });
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

const USAGE = 'usage: construct <outcome|work|log|inbox|decide|doctor|cleanup|version>\n';

/**
 * Async because `work` dispatches to a host. The other commands stay
 * synchronous — awaiting a number costs nothing and keeps one entry point.
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
    case 'log':
      return log(argv.slice(1));
    case 'inbox':
      return inbox();
    case 'decide':
      return decide(argv.slice(1));
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
