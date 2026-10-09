/**
 * kernel/calendar.ts — the wall clock in a timezone. One Intl formatter per
 * timezone gives the year, month, day, hour, minute and weekday an instant
 * has there; schedules and periods both read it, and nothing here reads the
 * environment or the system clock.
 */

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 0 is Sunday. */
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** What a clock on the wall in `timezone` reads at `instant`. */
export function wallClock(instant: Date, timezone: string): WallClock {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', minute: '2-digit', hour: '2-digit', day: '2-digit', month: '2-digit', weekday: 'short' });
    formatters.set(timezone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(instant).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday!] ?? 0 };
}

/** The calendar date (YYYY-MM-DD) an instant falls on in `timezone`. */
export function calendarDate(instant: string | Date, timezone: string): string {
  const w = wallClock(typeof instant === 'string' ? new Date(instant) : instant, timezone);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}
