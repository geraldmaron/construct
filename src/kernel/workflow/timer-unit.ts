/**
 * kernel/workflow/timer-unit.ts — the per-user platform timer that fires one
 * standing trigger: a launchd agent on macOS, a systemd user service and timer
 * on Linux. Pure text: what the unit says, never where it goes or who loads
 * it (hosts/timer.ts does that, only when the explicit command asks).
 *
 * The unit starts one short-lived `construct workflow fire` and exits. It
 * carries no key: the firing names the schedule slot that was due, so a late
 * or coalesced start after sleep covers that slot and a repeat deduplicates.
 * Its environment is PATH and nothing taken from the installing shell beyond
 * the paths it names, so no secret can ride along.
 */

import { parseCron, type CronFields } from './cron.ts';

/** What the installing machine supplies; none of it is a credential. */
export interface TimerFacts {
  /** The project's stable identity, minted at init. */
  readonly projectId: string;
  /** Absolute path to the Node binary the unit runs. */
  readonly node: string;
  /** Absolute path to Construct's launcher. */
  readonly launcher: string;
  /** The PATH the unit runs with: where Node and the executor live, then the system directories. */
  readonly path: string;
  /** Directory launchd writes the unit's output to. */
  readonly logDir: string;
  /** The timezone launchd evaluates a calendar in: the machine's own. */
  readonly systemTimezone: string;
  /** Non-secret variables the executor needs to find its own state (for example CODEX_HOME). */
  readonly env?: Readonly<Record<string, string>>;
}

export interface TimerUnitInput {
  readonly triggerId: string;
  readonly expression: string;
  readonly timezone: string;
  readonly executor: string;
  readonly projectRoot: string;
  readonly facts: TimerFacts;
}

export interface TimerUnitFile {
  readonly name: string;
  readonly content: string;
}

export type TimerPlatform = 'launchd' | 'systemd';

/** Variables a unit may carry. Anything else the installing shell holds stays out. */
export const TIMER_ENV_KEYS: readonly string[] = ['PATH', 'CODEX_HOME'];

/** More calendar entries than this is a schedule launchd would run as a table, not a calendar. */
const MAX_CALENDAR_ENTRIES = 512;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The one name a project and trigger's unit has, so reinstalling replaces it. */
export function timerLabel(projectId: string, triggerId: string): string {
  if (!SAFE_ID.test(projectId)) throw new Error(`project id "${projectId}" cannot name a platform timer`);
  if (!SAFE_ID.test(triggerId))
    throw new Error(
      `trigger id "${triggerId}" cannot name a platform timer; define the trigger with a --trigger-id of letters, digits, - and _`,
    );
  return `construct.${projectId}.${triggerId}`;
}

/** The files a platform timer is made of, by platform. */
export function timerFileNames(platform: TimerPlatform, label: string): readonly string[] {
  return platform === 'launchd' ? [`${label}.plist`] : [`${label}.service`, `${label}.timer`];
}

function covers(set: ReadonlySet<number>, min: number, max: number): boolean {
  for (let v = min; v <= max; v += 1) if (!set.has(v)) return false;
  return true;
}

function sorted(set: ReadonlySet<number>): number[] {
  return [...set].sort((a, b) => a - b);
}

/**
 * Which days a cron expression fires on, as cron reads it: a restricted day
 * and a restricted weekday match on either (both lists returned, meaning
 * their union), and a restricted field that covers its whole range is no
 * restriction. Null for a field that does not narrow the days.
 */
function dayRule(c: CronFields): { readonly day: number[] | null; readonly weekday: number[] | null } {
  const dayAll = !c.dayRestricted || covers(c.days, 1, 31);
  const weekdayAll = !c.weekdayRestricted || covers(c.weekdays, 0, 6);
  if (c.dayRestricted && c.weekdayRestricted && (covers(c.days, 1, 31) || covers(c.weekdays, 0, 6))) return { day: null, weekday: null };
  return { day: dayAll ? null : sorted(c.days), weekday: weekdayAll ? null : sorted(c.weekdays) };
}

type CalendarEntry = Readonly<Partial<Record<'Minute' | 'Hour' | 'Day' | 'Month' | 'Weekday', number>>>;

/**
 * The StartCalendarInterval entries a cron expression means, exactly. A field
 * cron leaves open is left out (launchd reads a missing key as any value), a
 * list or step is spelled out, and cron's rule that a restricted day and a
 * restricted weekday match on either becomes two sets of entries, one per
 * field. A timezone other than the machine's cannot be expressed at all,
 * because launchd evaluates every calendar in local time; that is refused
 * rather than shifted, since a shift is wrong on one side of each DST change.
 */
export function launchdCalendar(expression: string, timezone: string, systemTimezone: string): CalendarEntry[] {
  if (timezone !== systemTimezone) {
    throw new Error(
      `launchd evaluates a calendar in this Mac's timezone (${systemTimezone}), and this trigger is in ${timezone}; launchd cannot express it exactly. Define the trigger with --timezone=${systemTimezone}, or use \`workflow recipe --clock=cron\` with a cron that honors CRON_TZ`,
    );
  }
  const c: CronFields = parseCron(expression);
  const axes: Array<readonly [keyof CalendarEntry, number[] | null]> = [
    ['Minute', covers(c.minutes, 0, 59) ? null : sorted(c.minutes)],
    ['Hour', covers(c.hours, 0, 23) ? null : sorted(c.hours)],
    ['Month', covers(c.months, 1, 12) ? null : sorted(c.months)],
  ];
  const { day, weekday } = dayRule(c);
  const variants: Array<Array<readonly [keyof CalendarEntry, number[] | null]>> =
    day && weekday
      ? [
          [...axes, ['Day', day]],
          [...axes, ['Weekday', weekday]],
        ]
      : [[...axes, ['Day', day], ['Weekday', weekday]]];
  let count = 0;
  for (const v of variants) count += v.reduce((n, [, values]) => n * (values ? values.length : 1), 1);
  if (count > MAX_CALENDAR_ENTRIES) {
    throw new Error(
      `"${expression}" needs ${String(count)} launchd calendar entries (the limit is ${String(MAX_CALENDAR_ENTRIES)}); launchd cannot express it as a calendar. Choose a coarser schedule`,
    );
  }
  const out: CalendarEntry[] = [];
  for (const v of variants) {
    let partial: Array<Record<string, number>> = [{}];
    for (const [key, values] of v) {
      if (!values) continue;
      partial = partial.flatMap((entry) => values.map((value) => ({ ...entry, [key]: value })));
    }
    out.push(...partial);
  }
  return out;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * The OnCalendar lines a cron expression means, exactly, in its own timezone.
 * systemd matches a weekday and a day together, so cron's either-or becomes
 * two lines, which systemd unions.
 */
export function systemdCalendar(expression: string, timezone: string): string[] {
  const c = parseCron(expression);
  const list = (set: ReadonlySet<number>, min: number, max: number) =>
    covers(set, min, max)
      ? '*'
      : sorted(set)
          .map((v) => String(v).padStart(2, '0'))
          .join(',');
  const time = `${list(c.hours, 0, 23)}:${list(c.minutes, 0, 59)}:00`;
  const months = list(c.months, 1, 12);
  const { day, weekday } = dayRule(c);
  const days = day ? day.map((v) => String(v).padStart(2, '0')).join(',') : '*';
  const weekdays = weekday ? weekday.map((d) => WEEKDAY_NAMES[d]).join(',') : null;
  const line = (w: string | null, d: string) => `${w ? `${w} ` : ''}*-${months}-${d} ${time} ${timezone}`;
  if (day && weekday) return [line(null, days), line(weekdays, '*')];
  return [line(weekdays, days)];
}

function unitEnv(facts: TimerFacts): Array<readonly [string, string]> {
  const env: Array<readonly [string, string]> = [['PATH', facts.path]];
  for (const [key, value] of Object.entries(facts.env ?? {})) {
    if (!TIMER_ENV_KEYS.includes(key) || key === 'PATH')
      throw new Error(`a platform timer carries only ${TIMER_ENV_KEYS.join(' and ')}; ${key} stays out of the unit`);
    env.push([key, value]);
  }
  return env;
}

function fireArgs(input: TimerUnitInput): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(input.executor)) throw new Error('executor must be an adapter id, not a shell command');
  return [input.facts.node, input.facts.launcher, 'workflow', 'fire', input.triggerId, `--execute=${input.executor}`];
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A launchd agent: StartCalendarInterval only, never StartInterval, RunAtLoad, or KeepAlive. */
export function launchdUnit(input: TimerUnitInput): TimerUnitFile[] {
  const label = timerLabel(input.facts.projectId, input.triggerId);
  const calendar = launchdCalendar(input.expression, input.timezone, input.facts.systemTimezone);
  const str = (s: string) => `<string>${xml(refuseControl(s))}</string>`;
  const log = `${input.facts.logDir}/${label}.log`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<!-- A Construct platform timer. Installed only by construct workflow install-timer; removed by construct workflow remove-timer. -->',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>${str(label)}`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...fireArgs(input).map((a) => `    ${str(a)}`),
    '  </array>',
    `  <key>WorkingDirectory</key>${str(input.projectRoot)}`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...unitEnv(input.facts).map(([k, v]) => `    <key>${xml(k)}</key>${str(v)}`),
    '  </dict>',
    '  <key>StartCalendarInterval</key>',
    '  <array>',
    ...calendar.map(
      (entry) =>
        `    <dict>${Object.entries(entry)
          .map(([k, v]) => `<key>${k}</key><integer>${String(v)}</integer>`)
          .join('')}</dict>`,
    ),
    '  </array>',
    '  <key>ProcessType</key><string>Background</string>',
    `  <key>StandardOutPath</key>${str(log)}`,
    `  <key>StandardErrorPath</key>${str(log)}`,
    '</dict>',
    '</plist>',
    '',
  ];
  return [{ name: `${label}.plist`, content: lines.join('\n') }];
}

function refuseControl(value: string): string {
  // A control character would end the directive or smuggle another one in.
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error(`a platform timer cannot carry ${JSON.stringify(value)}: it holds a control character`);
  return value;
}

/**
 * A path directive (WorkingDirectory): taken literally except for specifiers,
 * so only % is doubled. It must be absolute, since a leading - or ~ means
 * something else to systemd, and it may not end in a backslash (systemd
 * joins the next line onto it) or in whitespace (systemd strips it).
 */
export function systemdPath(value: string): string {
  if (!value.startsWith('/')) throw new Error(`a platform timer needs an absolute directory, not ${JSON.stringify(value)}`);
  if (/[\\\s]$/.test(value))
    throw new Error(`systemd cannot hold the directory ${JSON.stringify(value)} exactly: it ends in a backslash or whitespace`);
  return refuseControl(value).replace(/%/g, '%%');
}

/**
 * A quoted word (Environment, ExecStart): backslash and double quote are
 * C-escaped and % is doubled against specifier expansion. A command word may
 * not hold $: systemd substitutes variables in arguments but looks the
 * executable up literally, so no single escape is right for both, and such
 * paths are refused rather than guessed at.
 */
export function systemdQuoted(value: string, command: boolean): string {
  if (command && value.includes('$')) throw new Error(`systemd cannot run ${JSON.stringify(value)} exactly: it holds a $`);
  return `"${refuseControl(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

function systemdUnquote(word: string): string {
  const inner = word.startsWith('"') && word.endsWith('"') ? word.slice(1, -1) : word;
  return inner.replace(/%%/g, '%').replace(/\\(["\\])/g, '$1');
}

/** A systemd user service and timer: OnCalendar with Persistent=true, so a slot missed while off runs once on return. */
export function systemdUnit(input: TimerUnitInput): TimerUnitFile[] {
  const label = timerLabel(input.facts.projectId, input.triggerId);
  const calendar = systemdCalendar(input.expression, input.timezone);
  const service = [
    '[Unit]',
    `Description=Construct trigger ${input.triggerId} (${input.expression} ${input.timezone})`,
    '',
    '[Service]',
    'Type=oneshot',
    `WorkingDirectory=${systemdPath(input.projectRoot)}`,
    ...unitEnv(input.facts).map(([k, v]) => `Environment=${systemdQuoted(`${k}=${v}`, false)}`),
    `ExecStart=${fireArgs(input)
      .map((a) => systemdQuoted(a, true))
      .join(' ')}`,
    '',
  ];
  const timer = [
    '[Unit]',
    `Description=Fires Construct trigger ${input.triggerId}; installed only by construct workflow install-timer`,
    '',
    '[Timer]',
    ...calendar.map((c) => `OnCalendar=${c}`),
    'Persistent=true',
    `Unit=${label}.service`,
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ];
  return [
    { name: `${label}.service`, content: service.join('\n') },
    { name: `${label}.timer`, content: timer.join('\n') },
  ];
}

export function timerUnit(platform: TimerPlatform, input: TimerUnitInput): TimerUnitFile[] {
  return platform === 'launchd' ? launchdUnit(input) : systemdUnit(input);
}

/** What an installed unit says about itself, read back from its own file. */
export interface InstalledTimerFacts {
  readonly label: string;
  readonly projectId: string;
  readonly triggerId: string;
  readonly projectRoot: string | null;
  readonly executor: string | null;
  /** The program the unit starts: the Node binary, then Construct's launcher. */
  readonly program: readonly string[];
}

/** Reads a unit this module wrote back into its facts; null for any other file. */
export function readTimerUnit(platform: TimerPlatform, name: string, content: string): InstalledTimerFacts | null {
  const m = /^construct\.([A-Za-z0-9][A-Za-z0-9_-]*)\.([A-Za-z0-9][A-Za-z0-9_-]*)\.(plist|service)$/.exec(name);
  if (!m || (platform === 'launchd') !== (m[3] === 'plist')) return null;
  const unxml = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  let root: string | null = null;
  let executor: string | null = null;
  let program: string[] = [];
  if (platform === 'launchd') {
    root = /<key>WorkingDirectory<\/key><string>([^<]*)<\/string>/.exec(content)?.[1] ?? null;
    if (root !== null) root = unxml(root);
    executor = /<string>--execute=([a-z][a-z0-9-]*)<\/string>/.exec(content)?.[1] ?? null;
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(content)?.[1] ?? '';
    program = [...args.matchAll(/<string>([^<]*)<\/string>/g)].slice(0, 2).map((a) => unxml(a[1]!));
  } else {
    const w = /^WorkingDirectory=(.*)$/m.exec(content)?.[1] ?? null;
    root = w === null ? null : w.replace(/%%/g, '%');
    executor = /--execute=([a-z][a-z0-9-]*)/.exec(content)?.[1] ?? null;
    const exec = /^ExecStart=(.*)$/m.exec(content)?.[1] ?? '';
    program = [...exec.matchAll(/"(?:[^"\\]|\\.)*"|\S+/g)].slice(0, 2).map((a) => systemdUnquote(a[0]));
  }
  return { label: `construct.${m[1]!}.${m[2]!}`, projectId: m[1]!, triggerId: m[2]!, projectRoot: root, executor, program };
}
