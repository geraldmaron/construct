/**
 * hosts/timer.ts — writes, loads, unloads, and lists the per-user platform
 * timers that fire standing triggers. Only `workflow install-timer` and
 * `workflow remove-timer` call installTimer and uninstallTimer; nothing in
 * init, install, the kernel, or a test setup reaches them.
 *
 * Every directory is an argument. The platform scheduler control refuses to
 * load a unit from any directory but the one this OS account's scheduler
 * reads (resolveAccountScheduleDir), so a redirected HOME can write a unit
 * into a scratch tree but can never hand it to the person's real launchd.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readTimerUnit, timerFileNames, type InstalledTimerFacts, type TimerPlatform, type TimerUnitFile } from '../kernel/workflow/timer-unit.ts';

export interface TimerTarget {
  readonly platform: TimerPlatform;
  /** The directory the unit files are written to. */
  readonly dir: string;
}

/** Loads and unloads units with the platform scheduler. Tests supply a recorder. */
export interface SchedulerControl {
  /** Throws, with the reason, when units in `dir` must not be handed to the scheduler. */
  admit(target: TimerTarget): void;
  load(target: TimerTarget, label: string): void;
  /** Unloads the unit; throws when it is still loaded afterwards. Does nothing when it was not loaded. */
  unload(target: TimerTarget, label: string): void;
  /** Whether the scheduler holds the unit in any form, so removing it must unload it; null when it cannot be asked. */
  loaded(target: TimerTarget, label: string): boolean | null;
  /** Whether the unit will fire: loaded on launchd, active and enabled on systemd; null when it cannot be asked. */
  firing(target: TimerTarget, label: string): boolean | null;
}

export function timerPlatformFor(platform: NodeJS.Platform): TimerPlatform | null {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') return 'systemd';
  return null;
}

export interface Ran {
  readonly ok: boolean;
  /** Exit status; null when the command was killed or never started. */
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
}

const run = (binary: string, args: string[]): Ran => {
  try {
    const stdout = execFileSync(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).toString();
    return { ok: true, status: 0, stdout: stdout.trim(), output: stdout.trim() };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: Buffer; stderr?: Buffer; message: string };
    const stdout = e.stdout?.toString().trim() ?? '';
    return { ok: false, status: typeof e.status === 'number' ? e.status : null, stdout, output: e.stderr?.toString().trim() || stdout || e.message };
  }
};

/**
 * What a scheduler query established: present, confirmed absent, or nothing.
 * A timeout or an unrecognized failure is not absence, and treating it as
 * absence would let removal delete the files of a job that keeps firing.
 */
function presence(query: string, ran: Ran, present: (r: Ran) => boolean, absent: (r: Ran) => boolean): boolean {
  // An unfinished command proves nothing, whatever it printed before it stopped.
  if (ran.status === null) throw new Error(`${query} did not finish (${ran.output || 'no output'}); nothing was changed`);
  if (present(ran)) return true;
  if (absent(ran)) return false;
  throw new Error(`${query} could not say whether the unit is loaded (${ran.status === null ? 'it did not finish' : `exit ${String(ran.status)}`}: ${ran.output || 'no output'}); nothing was changed`);
}

const UNLOAD_WAIT_MS = 10_000;
const UNLOAD_POLL_MS = 250;

const SYSTEMD_ACTIVE = new Set(['active', 'activating', 'reloading', 'refreshing']);
const SYSTEMD_INACTIVE = new Set(['inactive', 'failed', 'deactivating', 'maintenance']);
const SYSTEMD_ENABLED = new Set(['enabled', 'enabled-runtime', 'linked', 'linked-runtime', 'alias', 'static', 'indirect', 'generated', 'transient']);
const SYSTEMD_DISABLED = new Set(['disabled', 'masked', 'masked-runtime', 'not-found']);

/**
 * The real scheduler: launchctl in this user's GUI domain on macOS, the
 * systemd user manager on Linux. It admits only the account's own scheduler
 * directory.
 */
export function platformScheduler(accountDir: string | null, uid: number, command: (binary: string, args: string[]) => Ran = run, unloadWaitMs = UNLOAD_WAIT_MS): SchedulerControl {
  const run = command;
  const domain = `gui/${String(uid)}`;
  // launchctl print exits 113 for a service it does not hold.
  const launchdLoaded = (label: string) => presence('launchctl print', run('launchctl', ['print', `${domain}/${label}`]), (r) => r.ok, (r) => r.status === 113 || /could not find service/i.test(r.output));
  // systemctl names the state on stdout; only a named state, or the unit-specific not-found message, is an answer.
  const systemdActive = (label: string) => presence('systemctl is-active', run('systemctl', ['--user', 'is-active', `${label}.timer`]), (r) => SYSTEMD_ACTIVE.has(r.stdout), (r) => SYSTEMD_INACTIVE.has(r.stdout));
  const systemdEnabled = (label: string) => presence('systemctl is-enabled', run('systemctl', ['--user', 'is-enabled', `${label}.timer`]), (r) => SYSTEMD_ENABLED.has(r.stdout), (r) => SYSTEMD_DISABLED.has(r.stdout) || r.output.includes(`Failed to get unit file state for ${label}.timer: No such file or directory`));
  return {
    admit(target) {
      if (accountDir === null) throw new Error('this platform has no per-user scheduler Construct writes to');
      if (target.dir !== accountDir) {
        throw new Error(`the timer directory resolves to ${target.dir}, but this account's scheduler reads ${accountDir} (HOME or XDG_CONFIG_HOME is redirected); nothing was installed or removed`);
      }
    },
    load(target, label) {
      if (target.platform === 'launchd') {
        run('launchctl', ['bootout', `${domain}/${label}`]);
        const loaded = run('launchctl', ['bootstrap', domain, join(target.dir, `${label}.plist`)]);
        if (!loaded.ok) throw new Error(`launchctl bootstrap refused ${label}: ${loaded.output}`);
        return;
      }
      const reload = run('systemctl', ['--user', 'daemon-reload']);
      if (!reload.ok) throw new Error(`systemctl --user daemon-reload failed: ${reload.output}`);
      const enabled = run('systemctl', ['--user', 'enable', '--now', `${label}.timer`]);
      if (!enabled.ok) throw new Error(`systemctl --user enable --now ${label}.timer failed: ${enabled.output}`);
    },
    unload(target, label) {
      if (!this.loaded(target, label)) return;
      const result = target.platform === 'launchd'
        ? run('launchctl', ['bootout', `${domain}/${label}`])
        : run('systemctl', ['--user', 'disable', '--now', `${label}.timer`]);
      // launchd unloads a running job asynchronously (it signals the job and waits), so give it a few seconds.
      // The deadline is wall time, so slow queries count against it as well as the sleeps between them.
      const deadline = Date.now() + unloadWaitMs;
      while (this.loaded(target, label)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`the scheduler still has ${label} loaded ${String(unloadWaitMs / 1000)}s after unloading it (${result.output || 'no output'}); its files were kept`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(UNLOAD_POLL_MS, left));
      }
    },
    loaded(target, label) {
      if (target.platform === 'launchd') return launchdLoaded(label);
      // Enabled without active never fires; active without enabled is gone at the next login. Either still counts as there.
      return systemdActive(label) || systemdEnabled(label);
    },
    firing(target, label) {
      if (target.platform === 'launchd') return launchdLoaded(label);
      return systemdActive(label) && systemdEnabled(label);
    },
  };
}

export interface InstalledTimer extends InstalledTimerFacts {
  readonly files: readonly string[];
}

/** Writes the unit files (replacing any earlier ones under the same name) and loads them. */
export function installTimer(target: TimerTarget, label: string, files: readonly TimerUnitFile[], control: SchedulerControl, logDir: string): { readonly files: readonly string[]; readonly replaced: boolean } {
  control.admit(target);
  const expected = timerFileNames(target.platform, label);
  if (files.length !== expected.length || files.some((f, i) => f.name !== expected[i])) throw new Error(`unit files for ${label} must be ${expected.join(', ')}`);
  mkdirSync(target.dir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const written = files.map((f) => join(target.dir, f.name));
  const replaced = written.some((p) => existsSync(p));
  if (replaced) control.unload(target, label);
  for (const [i, f] of files.entries()) {
    const temp = `${written[i]!}.${String(process.pid)}.tmp`;
    writeFileSync(temp, f.content, { mode: 0o644 });
    renameSync(temp, written[i]!);
  }
  // launchd appends to the log forever; each install starts it fresh.
  if (target.platform === 'launchd') writeFileSync(join(logDir, `${label}.log`), '');
  control.load(target, label);
  return { files: written, replaced };
}

/** Unloads the unit and removes its files. Reports what was there. */
export function uninstallTimer(target: TimerTarget, label: string, control: SchedulerControl): { readonly removed: readonly string[] } {
  control.admit(target);
  const paths = timerFileNames(target.platform, label).map((n) => join(target.dir, n));
  const present = paths.filter((p) => existsSync(p));
  // Unload first, even when the files are already gone: a loaded job without files still fires.
  control.unload(target, label);
  for (const p of present) rmSync(p, { force: true });
  return { removed: present };
}

/** Every Construct timer in the directory, read back from its own files. */
export function listTimers(target: TimerTarget): InstalledTimer[] {
  let names: string[];
  try {
    names = readdirSync(target.dir);
  } catch {
    return [];
  }
  const out: InstalledTimer[] = [];
  for (const name of names.sort()) {
    if (!name.startsWith('construct.')) continue;
    let content: string;
    try {
      content = readFileSync(join(target.dir, name), 'utf8');
    } catch {
      continue;
    }
    const facts = readTimerUnit(target.platform, name, content);
    if (!facts) continue;
    out.push({ ...facts, files: timerFileNames(target.platform, facts.label).map((n) => join(target.dir, n)).filter((p) => existsSync(p)) });
  }
  return out;
}

/**
 * The machine's own timezone, the one launchd evaluates a calendar in: the
 * zone /etc/localtime links to, never TZ from the shell, which launchd does
 * not see. Falls back to the runtime's zone when the link is not readable.
 */
export function systemTimezone(): string {
  try {
    const target = readlinkSync('/etc/localtime');
    const m = /zoneinfo\/(.+)$/.exec(target);
    if (m) return m[1]!;
  } catch {
    // Not a link on this machine.
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The PATH a unit runs with: Node's directory, the executor's, then the system's. No other entry of the shell's PATH. */
export function timerPathFor(node: string, executorBinary: string | null): string {
  const dirs = [dirname(node), ...(executorBinary ? [dirname(executorBinary)] : []), '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set(dirs)].join(':');
}
