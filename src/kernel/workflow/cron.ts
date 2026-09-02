/**
 * kernel/workflow/cron.ts — when a five-field cron expression next fires in a
 * timezone. No dependency: wall-clock parts come from Intl, and the search
 * walks forward minute by minute, skipping whole days that cannot match.
 */

export interface CronFields {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
  readonly dayRestricted: boolean;
  readonly weekdayRestricted: boolean;
}

function field(spec: string, min: number, max: number, what: string): { readonly set: Set<number>; readonly restricted: boolean } {
  const set = new Set<number>();
  let restricted = true;
  for (const part of spec.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`cron ${what} "${part}" is not a value, range, or step`);
    const step = m[3] ? Number(m[3]) : 1;
    if (step < 1) throw new Error(`cron ${what} step must be positive`);
    let lo: number;
    let hi: number;
    if (m[1] === '*') {
      lo = min;
      hi = max;
      if (step === 1) restricted = false;
    } else {
      lo = Number(m[1]);
      hi = m[2] ? Number(m[2]) : m[3] ? max : lo;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron ${what} "${part}" is outside ${String(min)}-${String(max)}`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { set, restricted };
}

export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('a cron expression has five fields: minute hour day month weekday');
  const [mi, h, d, mo, w] = parts as [string, string, string, string, string];
  const minutes = field(mi, 0, 59, 'minute');
  const hours = field(h, 0, 23, 'hour');
  const days = field(d, 1, 31, 'day');
  const months = field(mo, 1, 12, 'month');
  const weekdays = field(w.replace(/\b7\b/g, '0'), 0, 6, 'weekday');
  return { minutes: minutes.set, hours: hours.set, days: days.set, months: months.set, weekdays: weekdays.set, dayRestricted: days.restricted, weekdayRestricted: weekdays.restricted };
}

interface WallClock {
  readonly minute: number;
  readonly hour: number;
  readonly day: number;
  readonly month: number;
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(instant: Date, timezone: string): WallClock {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', minute: '2-digit', hour: '2-digit', day: '2-digit', month: '2-digit', weekday: 'short' });
    formatters.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month), weekday: weekdays[parts.weekday!] ?? 0 };
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function matches(c: CronFields, w: WallClock): boolean {
  if (!c.minutes.has(w.minute) || !c.hours.has(w.hour) || !c.months.has(w.month)) return false;
  const dayOk = c.days.has(w.day);
  const weekdayOk = c.weekdays.has(w.weekday);
  if (c.dayRestricted && c.weekdayRestricted) return dayOk || weekdayOk;
  if (c.dayRestricted) return dayOk;
  if (c.weekdayRestricted) return weekdayOk;
  return true;
}

/** The first instant strictly after `after` at which the expression fires in `timezone`, or null within `horizonDays`. */
export function nextCronAfter(expression: string, timezone: string, after: string, horizonDays = 400): string | null {
  if (!isValidTimezone(timezone)) throw new Error(`"${timezone}" is not a timezone this runtime knows`);
  const c = parseCron(expression);
  const start = Date.parse(after);
  if (Number.isNaN(start)) throw new Error('after must be an ISO-8601 instant');
  let t = Math.floor(start / 60_000) * 60_000 + 60_000;
  const end = start + horizonDays * 86_400_000;
  while (t <= end) {
    const w = wallClock(new Date(t), timezone);
    if (!c.months.has(w.month)) {
      t += 86_400_000 - (w.hour * 3_600_000 + w.minute * 60_000);
      continue;
    }
    if (!matches(c, { ...w, minute: c.minutes.values().next().value ?? w.minute, hour: c.hours.values().next().value ?? w.hour })) {
      // Day does not match on its date fields; skip to the next day.
      const dayOk = (c.dayRestricted && c.weekdayRestricted) ? (c.days.has(w.day) || c.weekdays.has(w.weekday)) : (c.dayRestricted ? c.days.has(w.day) : c.weekdayRestricted ? c.weekdays.has(w.weekday) : true);
      if (!dayOk) {
        t += 86_400_000 - (w.hour * 3_600_000 + w.minute * 60_000);
        continue;
      }
    }
    if (matches(c, w)) return new Date(t).toISOString();
    t += 60_000;
  }
  return null;
}
