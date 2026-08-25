/**
 * kernel/schedule/units.ts — the text of a platform timer, generated and
 * nothing else.
 *
 * Construct owns no clock. What it owns is the exact wording of the entry the
 * operating system's own scheduler reads, and that wording is a pure function
 * of a cadence, a binary path, and the directory the entry lands in. Writing
 * the file and asking the platform to load it are separate acts that live in
 * the CLI, so everything here can be read back by a test without a real
 * launchd or systemd anywhere near it.
 *
 * Nothing in this module reads env or home: the caller resolves the directory
 * (kernel/paths.ts is the only module permitted to) and passes it in, the same
 * injected-paths discipline every other kernel module keeps.
 *
 * Calendar form is the only form generated. A plain interval firing that lands
 * while the machine is asleep is simply missed — launchd's own documentation
 * says so — and a laptop is asleep for most of the intervals a nightly cadence
 * names. Calendar firings coalesce into one event on wake, and systemd's
 * `Persistent=true` catches up the same way.
 */

import { join } from 'node:path';

/** The two platforms with a first-class user-level scheduler to write to. */
export type SchedulePlatform = 'darwin' | 'linux';

/** The launchd job label, which is also the plist's filename stem. */
export const SCHEDULE_LABEL = 'com.construct.schedule';

/** The systemd unit stem; the timer and its oneshot service share it. */
export const SCHEDULE_UNIT = 'construct-schedule';

/**
 * The line the timer fires, as argument lists. Two commands rather than one:
 * a standing outcome that came due and a source watch that came due are
 * different questions, and both are asked on every firing.
 */
export const SCHEDULE_COMMANDS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['standing', '--due']),
  Object.freeze(['watch', '--due']),
]);

/** A time of day a firing is anchored to. */
export interface ScheduleAnchor {
  readonly hour: number;
  readonly minute: number;
}

/** The hours of the day a firing lands on, and the minute past each. */
export interface ScheduleFiring {
  readonly hours: readonly number[];
  readonly minute: number;
}

/** One generated file: where it goes and what it says. */
export interface ScheduleUnit {
  readonly path: string;
  readonly text: string;
}

/** Everything an install writes and runs, and everything an uninstall undoes. */
export interface SchedulePlan {
  readonly platform: SchedulePlatform;
  readonly label: string;
  readonly firing: ScheduleFiring;
  readonly units: readonly ScheduleUnit[];
  /** The commands that ask the platform to load what was written. */
  readonly load: readonly (readonly string[])[];
  /** The commands that ask the platform to forget it, before the files go. */
  readonly unload: readonly (readonly string[])[];
}

export interface SchedulePlanInput {
  readonly platform: SchedulePlatform;
  /** Where the entry lands: the LaunchAgents directory, or the systemd user directory. */
  readonly dir: string;
  readonly everyMinutes: number;
  /** The time of day the cadence is anchored to, or null for the default. */
  readonly anchor: ScheduleAnchor | null;
  /** The interpreter that runs the entry point below. */
  readonly nodePath: string;
  /** The CLI entry point, absolute. */
  readonly cliPath: string;
  /** The user launchctl is asked to load the job for. Unread on Linux. */
  readonly uid: number;
}

/** The hour a daily cadence lands on when the caller names none. */
const DEFAULT_DAILY_HOUR = 9;

/** The cadences a calendar entry can state exactly, largest first. */
const HOUR_STEPS: readonly number[] = Object.freeze([1, 2, 3, 4, 6, 8, 12]);

export class ScheduleCadenceError extends Error {}

/**
 * Which hours of the day a cadence fires on.
 *
 * Only cadences that divide a day evenly are accepted, because those are the
 * ones a calendar entry can state without drifting: an every-five-hours entry
 * has no honest calendar spelling, and the alternatives — approximating it, or
 * falling back to an interval that sleep swallows — are both a schedule that
 * does not do what it was asked. Refusing is the only answer that stays true.
 */
export function firingTimes(everyMinutes: number, anchor: ScheduleAnchor | null): ScheduleFiring {
  if (!Number.isInteger(everyMinutes) || everyMinutes < 60 || everyMinutes % 60 !== 0) {
    throw new ScheduleCadenceError(
      'a schedule fires on whole hours: use --every=<N>h with N one of ' +
        `${HOUR_STEPS.join(', ')}, or --every=1d`,
    );
  }
  const step = everyMinutes / 60;
  if (step === 24) {
    const hour = anchor?.hour ?? DEFAULT_DAILY_HOUR;
    return { hours: [hour], minute: anchor?.minute ?? 0 };
  }
  if (!HOUR_STEPS.includes(step)) {
    throw new ScheduleCadenceError(
      `--every=${String(step)}h does not divide a day evenly, so no calendar entry states it ` +
        `exactly: use ${HOUR_STEPS.join('h, ')}h, or 1d`,
    );
  }
  // A sub-daily cadence with no named time starts at midnight; a named one
  // keeps its minute and its position inside the step, so `--at=02:30` on a
  // six-hour cadence reads 02:30, 08:30, 14:30, 20:30.
  const offset = (anchor?.hour ?? 0) % step;
  const hours: number[] = [];
  for (let hour = offset; hour < 24; hour += step) hours.push(hour);
  return { hours, minute: anchor?.minute ?? 0 };
}

/** A shell word, quoted so a path with spaces survives `/bin/sh -c`. */
function shellQuote(word: string): string {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Text that lands inside plist XML. */
function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The one shell line a launchd job runs, both commands chained. */
function shellLine(nodePath: string, cliPath: string): string {
  return SCHEDULE_COMMANDS.map(
    // Only the paths are quoted: the verb and its flag are literals this
    // module wrote, and quoting them makes the line unreadable for no gain.
    (command) => `${[nodePath, cliPath].map(shellQuote).join(' ')} ${command.join(' ')}`,
  ).join(' && ');
}

function plistText(input: SchedulePlanInput, firing: ScheduleFiring): string {
  const entries = firing.hours
    .map(
      (hour) =>
        '    <dict>\n' +
        `      <key>Hour</key>\n      <integer>${String(hour)}</integer>\n` +
        `      <key>Minute</key>\n      <integer>${String(firing.minute)}</integer>\n` +
        '    </dict>',
    )
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    '<dict>\n' +
    '  <key>Label</key>\n' +
    `  <string>${SCHEDULE_LABEL}</string>\n` +
    '  <key>ProgramArguments</key>\n' +
    '  <array>\n' +
    '    <string>/bin/sh</string>\n' +
    '    <string>-c</string>\n' +
    `    <string>${xmlEscape(shellLine(input.nodePath, input.cliPath))}</string>\n` +
    '  </array>\n' +
    '  <key>StartCalendarInterval</key>\n' +
    '  <array>\n' +
    `${entries}\n` +
    '  </array>\n' +
    // Nothing resident: the job exists for the length of one firing and the
    // supervisor owns everything about starting it.
    '  <key>KeepAlive</key>\n  <false/>\n' +
    '  <key>RunAtLoad</key>\n  <false/>\n' +
    '  <key>ProcessType</key>\n  <string>Background</string>\n' +
    '  <key>LowPriorityBackgroundIO</key>\n  <true/>\n' +
    '</dict>\n' +
    '</plist>\n'
  );
}

/** A systemd command word, quoted so a path with spaces survives the parser. */
function systemdQuote(word: string): string {
  return `"${word}"`;
}

function serviceText(input: SchedulePlanInput): string {
  const lines = SCHEDULE_COMMANDS.map(
    (command) =>
      `ExecStart=${[input.nodePath, input.cliPath].map(systemdQuote).join(' ')} ${command.join(' ')}`,
  );
  return (
    '[Unit]\n' +
    'Description=Construct: file and work whatever has come due\n' +
    '\n' +
    '[Service]\n' +
    // A oneshot, so the unit is not a process that lives between firings, and
    // a second command that runs only when the first succeeded.
    'Type=oneshot\n' +
    `${lines.join('\n')}\n`
  );
}

function timerText(firing: ScheduleFiring): string {
  return (
    '[Unit]\n' +
    'Description=Construct: fire what has come due\n' +
    '\n' +
    '[Timer]\n' +
    `OnCalendar=${onCalendar(firing)}\n` +
    // A firing whose moment passed while the machine was off is caught up on
    // the next boot rather than skipped.
    'Persistent=true\n' +
    'RandomizedDelaySec=300\n' +
    `Unit=${SCHEDULE_UNIT}.service\n` +
    '\n' +
    '[Install]\n' +
    'WantedBy=timers.target\n'
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The calendar expression for a firing, in systemd's own spelling. */
function onCalendar(firing: ScheduleFiring): string {
  const minute = pad(firing.minute);
  if (firing.hours.length === 1) return `*-*-* ${pad(firing.hours[0])}:${minute}:00`;
  const step = firing.hours[1] - firing.hours[0];
  return `*-*-* ${pad(firing.hours[0])}/${String(step)}:${minute}:00`;
}

/** Where a platform's entry lives, given the directory it lives in. */
export function scheduleUnitPaths(platform: SchedulePlatform, dir: string): readonly string[] {
  return platform === 'darwin'
    ? [join(dir, `${SCHEDULE_LABEL}.plist`)]
    : [join(dir, `${SCHEDULE_UNIT}.timer`), join(dir, `${SCHEDULE_UNIT}.service`)];
}

/**
 * The file whose text states the cadence. Read back rather than remembered
 * separately, so what a status line reports is what the platform will actually
 * fire on — a cadence kept in a second place is a cadence that can disagree
 * with the entry.
 */
export function scheduleCadencePath(platform: SchedulePlatform, dir: string): string {
  return scheduleUnitPaths(platform, dir)[0];
}

/** Everything an install writes and runs, from a cadence and a binary path. */
export function schedulePlan(input: SchedulePlanInput): SchedulePlan {
  const firing = firingTimes(input.everyMinutes, input.anchor);
  if (input.platform === 'darwin') {
    const path = scheduleCadencePath('darwin', input.dir);
    return {
      platform: 'darwin',
      label: SCHEDULE_LABEL,
      firing,
      units: [{ path, text: plistText(input, firing) }],
      load: [['launchctl', 'bootstrap', `gui/${String(input.uid)}`, path]],
      unload: [['launchctl', 'bootout', `gui/${String(input.uid)}/${SCHEDULE_LABEL}`]],
    };
  }
  const [timerPath, servicePath] = scheduleUnitPaths('linux', input.dir);
  return {
    platform: 'linux',
    label: `${SCHEDULE_UNIT}.timer`,
    firing,
    units: [
      { path: timerPath, text: timerText(firing) },
      { path: servicePath, text: serviceText(input) },
    ],
    load: [
      ['systemctl', '--user', 'daemon-reload'],
      ['systemctl', '--user', 'enable', '--now', `${SCHEDULE_UNIT}.timer`],
    ],
    unload: [
      ['systemctl', '--user', 'disable', '--now', `${SCHEDULE_UNIT}.timer`],
      ['systemctl', '--user', 'daemon-reload'],
    ],
  };
}

/**
 * The cadence an installed entry states, in minutes, read from its own text.
 * Null when the text is not one this module wrote — a hand-edited entry is
 * reported as unreadable rather than guessed at.
 */
export function cadenceMinutesFromUnitText(
  platform: SchedulePlatform,
  text: string,
): number | null {
  if (platform === 'darwin') {
    const hours = [...text.matchAll(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/g)].map((m) =>
      Number(m[1]),
    );
    if (hours.length === 0) return null;
    if (hours.length === 1) return 1440;
    const step = hours[1] - hours[0];
    return step > 0 ? step * 60 : null;
  }
  const match = /^OnCalendar=\*-\*-\* (\d{2})(?:\/(\d+))?:(\d{2}):00$/m.exec(text);
  if (!match) return null;
  return match[2] === undefined ? 1440 : Number(match[2]) * 60;
}
