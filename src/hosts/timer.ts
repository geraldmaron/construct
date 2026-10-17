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
  unload(target: TimerTarget, label: string): void;
  /** Whether the scheduler has the unit loaded; null when it cannot be asked. */
  loaded(target: TimerTarget, label: string): boolean | null;
}

export function timerPlatformFor(platform: NodeJS.Platform): TimerPlatform | null {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') return 'systemd';
  return null;
}

const run = (binary: string, args: string[]): { ok: boolean; output: string } => {
  try {
    return { ok: true, output: execFileSync(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).toString() };
  } catch (error) {
    const e = error as { stderr?: Buffer; message: string };
    return { ok: false, output: e.stderr?.toString().trim() || e.message };
  }
};

/**
 * The real scheduler: launchctl in this user's GUI domain on macOS, the
 * systemd user manager on Linux. It admits only the account's own scheduler
 * directory.
 */
export function platformScheduler(accountDir: string | null, uid: number): SchedulerControl {
  const domain = `gui/${String(uid)}`;
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
      if (target.platform === 'launchd') {
        run('launchctl', ['bootout', `${domain}/${label}`]);
        return;
      }
      run('systemctl', ['--user', 'disable', '--now', `${label}.timer`]);
    },
    loaded(target, label) {
      if (target.platform === 'launchd') return run('launchctl', ['print', `${domain}/${label}`]).ok;
      const active = run('systemctl', ['--user', 'is-enabled', `${label}.timer`]);
      return active.ok;
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
  control.load(target, label);
  return { files: written, replaced };
}

/** Unloads the unit and removes its files. Reports what was there. */
export function uninstallTimer(target: TimerTarget, label: string, control: SchedulerControl): { readonly removed: readonly string[] } {
  control.admit(target);
  const paths = timerFileNames(target.platform, label).map((n) => join(target.dir, n));
  const present = paths.filter((p) => existsSync(p));
  if (present.length === 0) return { removed: [] };
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
