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
 * them. By default nothing resident is installed and nothing starts at
 * login — the entry fires, the process runs once, and it exits.
 *
 * `--always-on` installs a second kind of entry instead: a supervised
 * long-running unit that runs `construct daemon run --foreground` and is
 * restarted by the platform on crash. The two kinds are mutually exclusive —
 * a calendar firing and an always-on daemon doing the same sweeps is double
 * work — so install refuses whichever tier isn't already on disk, and
 * uninstall removes whichever one is.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePaths, resolveScheduleDir } from '../kernel/paths.ts';
import {
  ScheduleCadenceError,
  alwaysOnPlan,
  alwaysOnUnitPaths,
  cadenceMinutesFromUnitText,
  scheduleCadencePath,
  schedulePlan,
  scheduleUnitPaths,
} from '../kernel/schedule/units.ts';
import type {
  AlwaysOnPlan,
  SchedulePlan,
  SchedulePlatform,
  ScheduleAnchor,
} from '../kernel/schedule/units.ts';
import { splitFlags } from './flags.ts';
import { parseCadence, renderCadence } from './cadence.ts';

const SCHEDULE_USAGE =
  'usage: construct schedule install --every=<N>h|1d [--at=HH:MM] [--dry-run]\n' +
  '       construct schedule install --always-on [--dry-run]\n' +
  '       construct schedule uninstall [--dry-run]\n' +
  '       construct schedule status\n' +
  '         (installs the platform entry that fires `construct standing --due`\n' +
  '          and `construct watch --due`; nothing resident is left running.\n' +
  '          --always-on installs a supervised daemon instead, running\n' +
  '          `construct daemon run --foreground`. The two are mutually\n' +
  '          exclusive: install one and the other refuses.)\n';

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
  /** Where a supervised daemon's own log lands; the state directory decides it. */
  readonly logPath: string;
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
  // Named here rather than imported from the resident's own module, the same
  // way cleanup names the daemon's leftovers: this file writes a supervisor
  // entry that points at a file, and reaching into the module that raises the
  // loop to learn a filename would put the one spawn path in this verb's
  // import graph for nothing.
  const logPath = join(resolvePaths(env).stateDir, 'daemon.log');
  return { platform, dir, nodePath, cliPath, uid, logPath };
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

/**
 * Writing the generated text where the platform expects to read it. Accepts
 * either tier's plan structurally — both name a `units` array — rather than
 * naming `SchedulePlan` and forcing the always-on tier through a cast.
 */
function writeUnits(plan: { readonly units: SchedulePlan['units'] }): void {
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

/** Which of the calendar tier's entry files are on disk right now. */
function installedCalendarUnits(context: Pick<ScheduleContext, 'platform' | 'dir'>): readonly string[] {
  return scheduleUnitPaths(context.platform, context.dir).filter((path) => existsSync(path));
}

/** Which of the always-on tier's entry files are on disk right now. */
function installedAlwaysOnUnits(context: Pick<ScheduleContext, 'platform' | 'dir'>): readonly string[] {
  return alwaysOnUnitPaths(context.platform, context.dir).filter((path) => existsSync(path));
}

/**
 * A calendar firing and a running on-demand daemon both sweep the same due
 * work, so both can file the same standing outcome. The store admits exactly
 * one of them — a firing is recorded in the same transaction that reads what
 * is due — so this is a warning about wasted work rather than a refusal about
 * lost work, and the calendar entry installs either way: the daemon is a
 * process the user can stop whenever they like, and refusing to write a
 * schedule because of it would tie a durable choice to a transient one. A dry
 * run says it too: what a dry run is for is seeing what installing would mean.
 */
function warnDaemonLive(): void {
  process.stderr.write(
    'schedule: a daemon is running on this machine and already sweeps what comes due — ' +
      'a calendar firing on top of it does the same work twice; stop it with: construct daemon stop\n',
  );
}

function scheduleInstall(
  flags: Record<string, string>,
  context: ScheduleContext,
  daemonLive: boolean,
): number {
  if (flags['always-on'] !== undefined) return scheduleInstallAlwaysOn(flags, context);
  if (daemonLive) warnDaemonLive();
  if (flags.every === undefined) {
    process.stderr.write(SCHEDULE_USAGE);
    return 2;
  }
  if (installedAlwaysOnUnits(context).length > 0) {
    process.stderr.write(
      'schedule: an always-on daemon is installed here already — a calendar firing on top of it is ' +
        'double work; remove it first with: construct schedule uninstall\n',
    );
    return 1;
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
  if (installedCalendarUnits(context).length > 0) runPlatformCommands(plan.unload);
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

/**
 * Installs the supervised, long-running unit instead of the calendar pair.
 * Refused whenever the calendar tier is already installed: a firing on a
 * cadence and an always-on daemon doing the same sweeps duplicate each
 * other's work, so the two tiers are mutually exclusive rather than layered.
 */
function scheduleInstallAlwaysOn(flags: Record<string, string>, context: ScheduleContext): number {
  if (installedCalendarUnits(context).length > 0) {
    process.stderr.write(
      'schedule: a calendar schedule is installed here already — an always-on daemon covering the same ' +
        'ground is double work; remove it first with: construct schedule uninstall\n',
    );
    return 1;
  }
  const plan: AlwaysOnPlan = alwaysOnPlan({
    platform: context.platform,
    dir: context.dir,
    nodePath: context.nodePath,
    cliPath: context.cliPath,
    uid: context.uid,
    logPath: context.logPath,
  });

  if (flags['dry-run'] !== undefined) {
    process.stdout.write('schedule: dry-run plan — always-on daemon\n');
    for (const unit of plan.units) {
      process.stdout.write(`\n${unit.path}\n${'-'.repeat(unit.path.length)}\n${unit.text}`);
    }
    process.stdout.write('\nwould then run:\n');
    for (const command of plan.load) process.stdout.write(`  ${command.join(' ')}\n`);
    process.stdout.write('\nNothing was written. Drop --dry-run to install it.\n');
    return 0;
  }

  if (installedAlwaysOnUnits(context).length > 0) runPlatformCommands(plan.unload);
  writeUnits(plan);
  const failed = runPlatformCommands(plan.load);
  process.stdout.write(`installed ${plan.label}: always-on daemon\n`);
  for (const unit of plan.units) process.stdout.write(`  ${unit.path}\n`);
  if (failed > 0) {
    process.stderr.write(
      'schedule: the entry was written but the platform did not load it — ' +
        'run the command above by hand, or remove it with construct schedule uninstall\n',
    );
    return 1;
  }
  process.stdout.write('  runs: construct daemon run --foreground\n');
  process.stdout.write('Read what it raises with: construct inbox\n');
  return 0;
}

/**
 * Removes whichever tier is installed, without the caller having to say
 * which. Both tiers are read for and unloaded if present — normally only one
 * ever is, because install refuses to lay the second tier on top of the
 * first, but uninstall stays defensive rather than assuming that refusal was
 * never bypassed by hand.
 */
function scheduleUninstall(flags: Record<string, string>, context: ScheduleContext): number {
  const calendar = installedCalendarUnits(context);
  const alwaysOnPaths = installedAlwaysOnUnits(context);
  const present = [...calendar, ...alwaysOnPaths];
  if (present.length === 0) {
    process.stdout.write('no schedule is installed; nothing to remove.\n');
    return 0;
  }
  // Regenerated only for the commands that undo a load: what gets removed is
  // whatever is on disk, so an entry written by an older cadence still goes.
  const plans: (SchedulePlan | AlwaysOnPlan)[] = [];
  if (calendar.length > 0) {
    plans.push(
      schedulePlan({
        platform: context.platform,
        dir: context.dir,
        everyMinutes: 1440,
        anchor: null,
        nodePath: context.nodePath,
        cliPath: context.cliPath,
        uid: context.uid,
      }),
    );
  }
  if (alwaysOnPaths.length > 0) {
    plans.push(
      alwaysOnPlan({
        platform: context.platform,
        dir: context.dir,
        nodePath: context.nodePath,
        cliPath: context.cliPath,
        uid: context.uid,
    logPath: context.logPath,
      }),
    );
  }
  if (flags['dry-run'] !== undefined) {
    process.stdout.write('schedule: dry-run plan — would run:\n');
    for (const plan of plans) {
      for (const command of plan.unload) process.stdout.write(`  ${command.join(' ')}\n`);
    }
    process.stdout.write('and remove:\n');
    for (const path of present) process.stdout.write(`  ${path}\n`);
    process.stdout.write('\nNothing was removed. Drop --dry-run to uninstall it.\n');
    return 0;
  }
  let failed = 0;
  for (const plan of plans) failed += runPlatformCommands(plan.unload);
  for (const path of present) rmSync(path, { force: true });
  process.stdout.write(plans.length === 1 ? `removed ${plans[0].label}:\n` : 'removed:\n');
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
  const alwaysOnPaths = installedAlwaysOnUnits(context);
  if (alwaysOnPaths.length > 0) {
    return `always-on daemon — ${alwaysOnPaths.join(', ')}`;
  }
  const calendar = installedCalendarUnits(context);
  if (calendar.length === 0) {
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
  return `${cadence} — ${calendar.join(', ')}`;
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
  /**
   * Whether an on-demand daemon is live here. A fact the caller establishes,
   * because deciding it means connecting to a socket and everything below is
   * a function of what it was given.
   */
  daemonLive = false,
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

  if (sub === 'install') return scheduleInstall(flags, context, daemonLive);
  if (sub === 'uninstall') return scheduleUninstall(flags, context);
  return scheduleStatus(context);
}
