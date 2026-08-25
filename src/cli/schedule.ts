/**
 * cli/schedule.ts — one verb for the clock Construct does not own.
 *
 * `standing --due` and `watch --due` fire whatever has elapsed and then exit;
 * something outside has to decide when to call them. That something is the
 * platform's own scheduler, and until this verb existed the instruction was
 * "write the entry yourself", which is a shell task in a tool whose whole
 * point is that its user never has to do one.
 *
 * The split here is deliberate. What the entry says is generated in the kernel
 * as pure text (kernel/schedule/units.ts) and can be read back by anyone,
 * including `--dry-run`. What this file adds is the two acts that touch the
 * machine: writing those files, and asking launchctl or systemctl to load
 * them. Nothing resident is installed and nothing starts at login — the entry
 * fires, the process runs once, and it exits.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveScheduleDir } from '../kernel/paths.ts';
import {
  ScheduleCadenceError,
  cadenceMinutesFromUnitText,
  scheduleCadencePath,
  schedulePlan,
  scheduleUnitPaths,
} from '../kernel/schedule/units.ts';
import type { SchedulePlan, SchedulePlatform, ScheduleAnchor } from '../kernel/schedule/units.ts';
import { splitFlags } from './flags.ts';
import { parseCadence, renderCadence } from './cadence.ts';

const SCHEDULE_USAGE =
  'usage: construct schedule install --every=<N>h|1d [--at=HH:MM] [--dry-run]\n' +
  '       construct schedule uninstall [--dry-run]\n' +
  '       construct schedule status\n' +
  '         (installs the platform entry that fires `construct standing --due`\n' +
  '          and `construct watch --due`; nothing resident is left running)\n';

/**
 * Where an install would write, what it would run, and who as. Resolved once
 * and passed down, so every function below is a function of what it was given
 * rather than of the machine it happens to be on.
 */
export interface ScheduleContext {
  readonly platform: SchedulePlatform;
  readonly dir: string;
  readonly nodePath: string;
  readonly cliPath: string;
  readonly uid: number;
}

/** Why a schedule cannot be installed here, in words a reader can act on. */
export interface ScheduleRefusal {
  readonly problem: string;
}

function isRefusal(value: ScheduleContext | ScheduleRefusal): value is ScheduleRefusal {
  return 'problem' in value;
}

/**
 * The entry point a scheduler should call, resolved from the process that is
 * running right now.
 *
 * An entry naming a path that does not exist, or one inside a temporary
 * directory, is refused rather than written: the file it points at is gone by
 * the time the scheduler fires it, and a schedule whose every firing fails
 * silently is worse than no schedule, because the tracker keeps showing a
 * cadence nobody is honoring.
 */
export function resolveScheduleContext(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  entry: string | undefined = process.argv[1],
  nodePath: string = process.execPath,
  uid: number = typeof process.getuid === 'function' ? process.getuid() : 0,
): ScheduleContext | ScheduleRefusal {
  const dir = resolveScheduleDir(platform, env);
  if (dir === null || (platform !== 'darwin' && platform !== 'linux')) {
    return {
      problem:
        `${platform} has no user-level scheduler Construct writes to — ` +
        'schedule `construct standing --due && construct watch --due` with whatever this machine already uses',
    };
  }
  if (entry === undefined || entry === '') {
    return { problem: 'this process names no entry point to schedule' };
  }
  let cliPath: string;
  try {
    cliPath = realpathSync(resolve(entry));
  } catch {
    return { problem: `${entry} does not exist, so a scheduler could not run it` };
  }
  const temp = realpathSync(tmpdir());
  if (cliPath.startsWith(`${temp}/`)) {
    return {
      problem:
        `${cliPath} is inside a temporary directory, so it will not be there when the schedule fires — ` +
        'install Construct first, then run this from the installed copy',
    };
  }
  // A path a shell or a unit file cannot carry literally would be quoted into
  // something other than itself.
  for (const path of [cliPath, nodePath]) {
    if (/["\n]/.test(path)) {
      return { problem: `${path} contains a character a scheduler entry cannot carry` };
    }
  }
  return { platform, dir, nodePath, cliPath, uid };
}

/** `--at=HH:MM`, or null when the caller named none. */
function parseAnchor(value: string | undefined): ScheduleAnchor | null {
  if (value === undefined) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2]) : NaN;
  if (!match || hour > 23 || minute > 59) {
    throw new ScheduleCadenceError(`--at takes a time of day as HH:MM, got "${value}"`);
  }
  return { hour, minute };
}

/** The cadence, in words, of a plan about to be written. */
function describe(plan: SchedulePlan, everyMinutes: number): string {
  const times = plan.firing.hours
    .map((hour) => `${String(hour).padStart(2, '0')}:${String(plan.firing.minute).padStart(2, '0')}`)
    .join(', ');
  return `every ${renderCadence(everyMinutes)} (at ${times})`;
}

/** Writing the generated text where the platform expects to read it. */
function writeUnits(plan: SchedulePlan): void {
  for (const unit of plan.units) {
    mkdirSync(dirname(unit.path), { recursive: true });
    writeFileSync(unit.path, unit.text);
  }
}

/**
 * Asking the platform to load or forget the entry. Failures are reported and
 * never thrown: a written entry the supervisor refused is a state the user can
 * fix by hand, and hiding which of the two steps failed is what makes that
 * impossible.
 */
function runPlatformCommands(commands: readonly (readonly string[])[]): number {
  let failed = 0;
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error !== undefined || result.status !== 0) {
      failed += 1;
      const detail =
        result.error?.message ?? `${(result.stderr ?? '').trim() || `exit ${String(result.status)}`}`;
      process.stderr.write(`schedule: ${command} ${args.join(' ')} — ${detail}\n`);
    }
  }
  return failed;
}

/** Which of a platform's entry files are on disk right now. */
function installedUnits(context: Pick<ScheduleContext, 'platform' | 'dir'>): readonly string[] {
  return scheduleUnitPaths(context.platform, context.dir).filter((path) => existsSync(path));
}

function scheduleInstall(flags: Record<string, string>, context: ScheduleContext): number {
  if (flags.every === undefined) {
    process.stderr.write(SCHEDULE_USAGE);
    return 2;
  }
  let everyMinutes: number;
  let anchor: ScheduleAnchor | null;
  let plan: SchedulePlan;
  try {
    everyMinutes = parseCadence(flags.every);
    anchor = parseAnchor(flags.at);
    plan = schedulePlan({
      platform: context.platform,
      dir: context.dir,
      everyMinutes,
      anchor,
      nodePath: context.nodePath,
      cliPath: context.cliPath,
      uid: context.uid,
    });
  } catch (error) {
    process.stderr.write(`schedule: ${(error as Error).message}\n`);
    return 2;
  }

  if (flags['dry-run'] !== undefined) {
    process.stdout.write(`schedule: dry-run plan — ${describe(plan, everyMinutes)}\n`);
    for (const unit of plan.units) {
      process.stdout.write(`\n${unit.path}\n${'-'.repeat(unit.path.length)}\n${unit.text}`);
    }
    process.stdout.write('\nwould then run:\n');
    for (const command of plan.load) process.stdout.write(`  ${command.join(' ')}\n`);
    process.stdout.write('\nNothing was written. Drop --dry-run to install it.\n');
    return 0;
  }

  // Replacing rather than refusing, so a cadence change is one command. The
  // platform is asked to forget the old entry first: a launchd job left loaded
  // against a rewritten plist keeps firing the schedule that was replaced.
  if (installedUnits(context).length > 0) runPlatformCommands(plan.unload);
  writeUnits(plan);
  const failed = runPlatformCommands(plan.load);
  process.stdout.write(`installed ${plan.label}: ${describe(plan, everyMinutes)}\n`);
  for (const unit of plan.units) process.stdout.write(`  ${unit.path}\n`);
  if (failed > 0) {
    process.stderr.write(
      'schedule: the entry was written but the platform did not load it — ' +
        'run the command above by hand, or remove it with construct schedule uninstall\n',
    );
    return 1;
  }
  process.stdout.write('  fires: construct standing --due && construct watch --due\n');
  process.stdout.write('Read what it raises with: construct inbox\n');
  return 0;
}

function scheduleUninstall(flags: Record<string, string>, context: ScheduleContext): number {
  const present = installedUnits(context);
  if (present.length === 0) {
    process.stdout.write('no schedule is installed; nothing to remove.\n');
    return 0;
  }
  // Regenerated only for the commands that undo a load: what gets removed is
  // whatever is on disk, so an entry written by an older cadence still goes.
  const plan = schedulePlan({
    platform: context.platform,
    dir: context.dir,
    everyMinutes: 1440,
    anchor: null,
    nodePath: context.nodePath,
    cliPath: context.cliPath,
    uid: context.uid,
  });
  if (flags['dry-run'] !== undefined) {
    process.stdout.write('schedule: dry-run plan — would run:\n');
    for (const command of plan.unload) process.stdout.write(`  ${command.join(' ')}\n`);
    process.stdout.write('and remove:\n');
    for (const path of present) process.stdout.write(`  ${path}\n`);
    process.stdout.write('\nNothing was removed. Drop --dry-run to uninstall it.\n');
    return 0;
  }
  const failed = runPlatformCommands(plan.unload);
  for (const path of present) rmSync(path, { force: true });
  process.stdout.write(`removed ${plan.label}:\n`);
  for (const path of present) process.stdout.write(`  ${path}\n`);
  if (failed > 0) {
    process.stderr.write(
      'schedule: the files are gone but the platform reported an error forgetting the entry — ' +
        'it may still be loaded until the next login\n',
    );
    return 1;
  }
  return 0;
}

/**
 * What is installed, read from the entry itself. An absent schedule is a
 * normal state and is reported as one: this reads files and asks the platform
 * nothing.
 */
export function scheduleStatusLine(context: Pick<ScheduleContext, 'platform' | 'dir'>): string {
  const present = installedUnits(context);
  if (present.length === 0) {
    return 'no schedule installed — install one with: construct schedule install --every=6h';
  }
  const cadencePath = scheduleCadencePath(context.platform, context.dir);
  let minutes: number | null = null;
  try {
    minutes = cadenceMinutesFromUnitText(context.platform, readFileSync(cadencePath, 'utf8'));
  } catch {
    minutes = null;
  }
  const cadence = minutes === null ? 'cadence unreadable (edited by hand?)' : `every ${renderCadence(minutes)}`;
  return `${cadence} — ${present.join(', ')}`;
}

/**
 * The same one line, for a caller that has only a platform and an environment
 * to go on — `doctor`, which reports what is installed and asks the platform
 * nothing. An absent schedule is a normal state, so this never fails; it only
 * says which state the machine is in.
 */
export function scheduleReport(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = resolveScheduleDir(platform, env);
  if (dir === null || (platform !== 'darwin' && platform !== 'linux')) {
    return `${platform} has no user-level scheduler Construct writes to`;
  }
  return scheduleStatusLine({ platform, dir });
}

function scheduleStatus(context: ScheduleContext): number {
  process.stdout.write(`${scheduleStatusLine(context)}\n`);
  return 0;
}

/**
 * Install, remove, or report the platform entry that fires what has come due.
 *
 * The context is a parameter so the two acts that touch the machine stay
 * addressable: a caller supplies where an entry would go and what it would
 * run, and the writing and loading below act on exactly that.
 */
export function schedule(
  argv: string[],
  context: ScheduleContext | ScheduleRefusal = resolveScheduleContext(),
): number {
  const { flags, words } = splitFlags(argv);
  const sub = words[0];

  if (sub !== 'install' && sub !== 'uninstall' && sub !== 'status' && sub !== undefined) {
    process.stderr.write(SCHEDULE_USAGE);
    return 2;
  }

  if (isRefusal(context)) {
    // Status answers the question it was asked — there is no schedule here —
    // rather than reading as a broken install.
    const stream = sub === 'status' || sub === undefined ? process.stdout : process.stderr;
    stream.write(`schedule: ${context.problem}\n`);
    return sub === 'status' || sub === undefined ? 0 : 1;
  }

  if (sub === 'install') return scheduleInstall(flags, context);
  if (sub === 'uninstall') return scheduleUninstall(flags, context);
  return scheduleStatus(context);
}
