/**
 * kernel/registry/slots.ts — input types the kernel defines and checks
 * itself: a period, resolved from the calendar into labeled dates, and a
 * list of declared source ids.
 *
 * A period is exactly one of: relative (last_week, this_quarter, …), a
 * quarter with or without a year, a year alone, or from/to dates. Dates may
 * accompany relative, quarter or year only when they equal what those work
 * out to. this_X is the whole current unit and says when it ends after
 * today; weeks run Monday to Sunday; quarters are calendar quarters; a
 * quarter without a year is the most recent one that has started. as_of
 * keeps only the end date. Every resolution lists what it took as given.
 *
 * Pure: the instant and the caller's timezone are always passed in.
 */

import { calendarDate, isValidTimezone } from '../calendar.ts';

export const SLOT_TYPES = ['period', 'source_ids'] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const PERIOD_SEMANTICS = ['as_of', 'changed_during', 'evidence_window'] as const;
export type PeriodSemantics = (typeof PERIOD_SEMANTICS)[number];

export const PERIOD_RELATIVES = ['this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'year_to_date', 'last_n_days'] as const;
export type PeriodRelative = (typeof PERIOD_RELATIVES)[number];

/** The longest last_n_days window, in days: about ten years. */
export const MAX_PERIOD_DAYS = 3660;
const MAX_PHRASE = 200;

/** A period as the person framed it. */
export interface PeriodSpec {
  readonly semantics: PeriodSemantics;
  readonly relative?: PeriodRelative;
  readonly n?: number;
  readonly quarter?: number;
  readonly year?: number;
  readonly from?: string;
  readonly to?: string;
  readonly timezone?: string;
  /** The person's own words for it, such as "Q3". */
  readonly phrase?: string;
}

/** A period worked out into dates. */
export interface ResolvedPeriod {
  readonly semantics: PeriodSemantics;
  /** Null for as_of, which names a single day. */
  readonly from: string | null;
  readonly to: string;
  readonly timezone: string;
  readonly how: 'relative' | 'quarter' | 'year' | 'dates';
  readonly relative?: PeriodRelative;
  readonly n?: number;
  readonly quarter?: number;
  readonly year?: number;
  readonly phrase?: string;
  /** The instant it was worked out against. */
  readonly resolvedAt: string;
  /** The window runs past today. */
  readonly endsAfterToday: boolean;
  /** What was taken as given, in plain words. */
  readonly assumptions: readonly string[];
}

export interface SlotProblem {
  readonly code: 'schema_mismatch' | 'unavailable_source';
  readonly message: string;
  readonly remedy: string;
}

export interface SlotContext {
  /** The instant relative periods are worked out against. */
  readonly at: string;
  /** The ids of the active declared sources. */
  readonly sourceIds: readonly string[];
  /** The caller's timezone, used when the period names none; UTC otherwise. */
  readonly timezone?: string;
}

const PERIOD_KEYS = ['semantics', 'relative', 'n', 'quarter', 'year', 'from', 'to', 'timezone', 'phrase'] as const;

export function isSlotType(type: string): type is SlotType {
  return (SLOT_TYPES as readonly string[]).includes(type);
}

/** What a value of this type looks like, said once for a remedy. */
export function describeSlot(type: SlotType): string {
  if (type === 'source_ids') return 'a list of declared source ids, such as ["jira", "confluence"]';
  return `{"semantics": ${PERIOD_SEMANTICS.join(' | ')}, and one of "relative" (${PERIOD_RELATIVES.join(', ')}; last_n_days also takes "n"), "quarter" (1-4, with or without "year"), "year" alone, or "from" and "to" as YYYY-MM-DD; optional "timezone" and "phrase"}, for example {"semantics": "changed_during", "relative": "last_week"}`;
}

// ---------------------------------------------------------------- dates

interface Day { readonly y: number; readonly m: number; readonly d: number }

function dayText(x: Day): string {
  return `${String(x.y).padStart(4, '0')}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
}

/** A real calendar date in YYYY-MM-DD form, or null. */
function parseDay(text: unknown): Day | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null;
}

function fromUtc(t: Date): Day {
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function addDays(x: Day, n: number): Day {
  return fromUtc(new Date(Date.UTC(x.y, x.m - 1, x.d + n)));
}

function lastOfMonth(y: number, m: number): Day {
  return fromUtc(new Date(Date.UTC(y, m, 0)));
}

function quarterOf(x: Day): number {
  return Math.floor((x.m - 1) / 3) + 1;
}

function quarterWindow(y: number, q: number): { from: Day; to: Day } {
  return { from: { y, m: q * 3 - 2, d: 1 }, to: lastOfMonth(y, q * 3) };
}

/** An ISO date and time written without a zone, such as 2026-10-05T23:30:00. */
const ZONELESS_TIME = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * The calendar date an instant (or a bare YYYY-MM-DD) falls on in `timezone`,
 * or null when it is not a time. A date and time written without a zone is
 * read as written, on its own date, whatever timezone this machine is in.
 */
export function dayOf(instant: string, timezone: string): string | null {
  if (typeof instant !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return parseDay(instant) ? instant : null;
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return null;
  const zoneless = ZONELESS_TIME.exec(instant);
  if (zoneless) return parseDay(zoneless[1]) ? zoneless[1]! : null;
  return calendarDate(new Date(t), isValidTimezone(timezone) ? timezone : 'UTC');
}

// ---------------------------------------------------------------- periods

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function isWhole(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

interface Window {
  readonly how: ResolvedPeriod['how'];
  readonly from: Day;
  readonly to: Day;
  readonly year?: number;
  readonly assumptions: string[];
}

/** The whole window a well-formed spec names, before as_of keeps only its end. */
function windowOf(spec: Record<string, unknown>, today: Day): Window {
  const assumptions: string[] = [];
  if (spec.relative !== undefined) {
    const relative = spec.relative as PeriodRelative;
    const monday = addDays(today, -((new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() + 6) % 7));
    const q = quarterOf(today);
    switch (relative) {
      case 'this_week':
        assumptions.push('weeks run Monday to Sunday');
        return { how: 'relative', from: monday, to: addDays(monday, 6), assumptions };
      case 'last_week':
        assumptions.push('weeks run Monday to Sunday');
        return { how: 'relative', from: addDays(monday, -7), to: addDays(monday, -1), assumptions };
      case 'this_month':
        return { how: 'relative', from: { y: today.y, m: today.m, d: 1 }, to: lastOfMonth(today.y, today.m), assumptions };
      case 'last_month': {
        const y = today.m === 1 ? today.y - 1 : today.y;
        const m = today.m === 1 ? 12 : today.m - 1;
        return { how: 'relative', from: { y, m, d: 1 }, to: lastOfMonth(y, m), assumptions };
      }
      case 'this_quarter':
        assumptions.push('quarters are calendar quarters');
        return { how: 'relative', ...quarterWindow(today.y, q), assumptions };
      case 'last_quarter':
        assumptions.push('quarters are calendar quarters');
        return { how: 'relative', ...(q === 1 ? quarterWindow(today.y - 1, 4) : quarterWindow(today.y, q - 1)), assumptions };
      case 'this_year':
        return { how: 'relative', from: { y: today.y, m: 1, d: 1 }, to: { y: today.y, m: 12, d: 31 }, assumptions };
      case 'last_year':
        return { how: 'relative', from: { y: today.y - 1, m: 1, d: 1 }, to: { y: today.y - 1, m: 12, d: 31 }, assumptions };
      case 'year_to_date':
        assumptions.push('year_to_date runs from January 1 to today');
        return { how: 'relative', from: { y: today.y, m: 1, d: 1 }, to: today, assumptions };
      case 'last_n_days':
        assumptions.push('last_n_days counts today');
        return { how: 'relative', from: addDays(today, -((spec.n as number) - 1)), to: today, assumptions };
    }
  }
  if (spec.quarter !== undefined) {
    const q = spec.quarter as number;
    assumptions.push('quarters are calendar quarters');
    let y = spec.year as number | undefined;
    if (y === undefined) {
      y = dayText(quarterWindow(today.y, q).from) <= dayText(today) ? today.y : today.y - 1;
      assumptions.push(`Q${String(q)} taken as ${String(y)}, the most recent Q${String(q)} that has started`);
    }
    return { how: 'quarter', ...quarterWindow(y, q), year: y, assumptions };
  }
  if (spec.year !== undefined) {
    const y = spec.year as number;
    return { how: 'year', from: { y, m: 1, d: 1 }, to: { y, m: 12, d: 31 }, year: y, assumptions };
  }
  const to = parseDay(spec.to)!;
  const from = parseDay(spec.from) ?? to;
  return { how: 'dates', from, to, assumptions };
}

/** Everything wrong with a period, in plain words; empty when it is well formed. */
function periodProblems(key: string, value: unknown, at: string, callerTimezone: string | undefined): string[] {
  if (!isRecord(value)) return [`input "${key}" is ${Array.isArray(value) ? 'a list' : value === null ? 'null' : typeof value}, not a period`];
  const problems: string[] = [];
  const unknown = Object.keys(value).filter((k) => !(PERIOD_KEYS as readonly string[]).includes(k));
  if (unknown.length) problems.push(`input "${key}" has ${unknown.map((k) => `"${k}"`).join(', ')}, which a period does not take (it takes ${PERIOD_KEYS.join(', ')})`);
  if (typeof value.semantics !== 'string' || !(PERIOD_SEMANTICS as readonly string[]).includes(value.semantics)) {
    problems.push(`input "${key}" needs "semantics", one of ${PERIOD_SEMANTICS.join(', ')}${value.semantics === undefined ? '' : ` (got ${JSON.stringify(value.semantics)})`}`);
  }
  if (value.relative !== undefined && (typeof value.relative !== 'string' || !(PERIOD_RELATIVES as readonly string[]).includes(value.relative))) {
    problems.push(`input "${key}" has relative ${JSON.stringify(value.relative)}; relative is one of ${PERIOD_RELATIVES.join(', ')}`);
  }
  if (value.n !== undefined) {
    if (value.relative !== 'last_n_days') problems.push(`input "${key}" gives "n", which only last_n_days takes`);
    else if (!isWhole(value.n) || value.n < 1 || value.n > MAX_PERIOD_DAYS) problems.push(`input "${key}" has n ${JSON.stringify(value.n)}; n is a whole number of days from 1 to ${String(MAX_PERIOD_DAYS)}`);
  } else if (value.relative === 'last_n_days') {
    problems.push(`input "${key}" is last_n_days without "n", the number of days`);
  }
  if (value.quarter !== undefined && (!isWhole(value.quarter) || value.quarter < 1 || value.quarter > 4)) problems.push(`input "${key}" has quarter ${JSON.stringify(value.quarter)}; quarter is 1, 2, 3 or 4`);
  if (value.year !== undefined && (!isWhole(value.year) || value.year < 1000 || value.year > 9999)) problems.push(`input "${key}" has year ${JSON.stringify(value.year)}; year is a four-digit whole number such as 2026`);
  for (const k of ['from', 'to'] as const) {
    if (value[k] !== undefined && !parseDay(value[k])) problems.push(`input "${key}" has ${k} ${JSON.stringify(value[k])}, which is not a real date as YYYY-MM-DD`);
  }
  if (value.timezone !== undefined && (typeof value.timezone !== 'string' || !isValidTimezone(value.timezone))) problems.push(`input "${key}" has timezone ${JSON.stringify(value.timezone)}, which is not an IANA timezone this runtime knows`);
  if (value.phrase !== undefined && (typeof value.phrase !== 'string' || value.phrase.length > MAX_PHRASE)) problems.push(`input "${key}" has a phrase that is not text of at most ${String(MAX_PHRASE)} characters`);
  if (problems.length) return problems;

  const hasRelative = value.relative !== undefined;
  const hasQuarter = value.quarter !== undefined;
  const hasYear = value.year !== undefined;
  const hasDates = value.from !== undefined || value.to !== undefined;
  if (hasRelative && (hasQuarter || hasYear)) return [`input "${key}" gives relative and ${hasQuarter ? 'quarter' : 'year'}; give one way of naming the period`];
  if (!hasRelative && !hasQuarter && !hasYear) {
    if (!hasDates) return [`input "${key}" names no period: give relative, quarter, year, or from and to`];
    if (value.to === undefined) return [`input "${key}" gives from without to; a period needs its end date`];
    if (value.from === undefined && value.semantics !== 'as_of') return [`input "${key}" gives to without from; a ${String(value.semantics)} period needs both dates (as_of takes only to)`];
    if (value.from !== undefined && (value.from as string) > (value.to as string)) return [`input "${key}" runs from ${String(value.from)} to ${String(value.to)}; from must not be after to`];
    return [];
  }
  if (hasDates) {
    const tz = typeof value.timezone === 'string' ? value.timezone : callerTimezone && isValidTimezone(callerTimezone) ? callerTimezone : 'UTC';
    const today = parseDay(calendarDate(at, tz))!;
    const w = windowOf(value, today);
    const resolved = resolvePeriod(value as unknown as PeriodSpec, at, callerTimezone);
    const fromOk = value.from === undefined || value.from === dayText(w.from);
    const toOk = value.to === undefined || value.to === dayText(w.to) || (value.semantics === 'as_of' && value.to === resolved.to);
    if (!fromOk || !toOk) {
      const named = hasRelative ? String(value.relative) : hasQuarter ? `Q${String(value.quarter)}${hasYear ? ` ${String(value.year)}` : ''}` : String(value.year);
      const given = [value.from !== undefined ? `from ${String(value.from)}` : '', value.to !== undefined ? `to ${String(value.to)}` : ''].filter(Boolean).join(' and ');
      return [`input "${key}" gives ${given}, but ${named} on ${dayText(today)} (${tz}) runs from ${dayText(w.from)} to ${dayText(w.to)}; drop the dates or make them agree`];
    }
  }
  return [];
}

/**
 * Work a well-formed period out into dates at `at`. The timezone is the
 * period's own, else the caller's, else UTC. Throws on a period checkSlot
 * would refuse.
 */
export function resolvePeriod(spec: PeriodSpec, at: string, timezone?: string): ResolvedPeriod {
  const raw = spec as unknown as Record<string, unknown>;
  const tz = typeof spec.timezone === 'string' && isValidTimezone(spec.timezone) ? spec.timezone : timezone && isValidTimezone(timezone) ? timezone : 'UTC';
  if (Number.isNaN(Date.parse(at))) throw new Error(`"${at}" is not an instant to work a period out against`);
  const todayText = calendarDate(at, tz);
  const today = parseDay(todayText)!;
  if (!isRecord(raw) || typeof raw.semantics !== 'string' || !(PERIOD_SEMANTICS as readonly string[]).includes(raw.semantics)) throw new Error('a period needs semantics');
  const w = windowOf(raw, today);
  const assumptions = [`dates are in ${tz}`, ...w.assumptions];
  let from: string | null = dayText(w.from);
  let to = dayText(w.to);
  let endsAfterToday = to > todayText;
  if (endsAfterToday && spec.relative !== undefined) assumptions.push(`${spec.relative} is the whole ${spec.relative.slice('this_'.length)}, which ends after today (${todayText})`);
  else if (endsAfterToday) assumptions.push(`the period ends after today (${todayText})`);
  if (spec.semantics === 'as_of') {
    from = null;
    assumptions.push('as_of keeps only the end date');
    if (endsAfterToday) {
      to = todayText;
      endsAfterToday = false;
      assumptions.push(`its end is after today, so it is taken as of today (${todayText})`);
    }
  }
  return {
    semantics: spec.semantics,
    from,
    to,
    timezone: tz,
    how: w.how,
    ...(spec.relative !== undefined ? { relative: spec.relative } : {}),
    ...(spec.n !== undefined ? { n: spec.n } : {}),
    ...(w.how === 'quarter' ? { quarter: spec.quarter } : {}),
    ...(w.year !== undefined ? { year: w.year } : {}),
    ...(spec.phrase !== undefined ? { phrase: spec.phrase } : {}),
    resolvedAt: at,
    endsAfterToday,
    assumptions,
  };
}

// ---------------------------------------------------------------- source ids

/** Source ids as given, trimmed, with blanks and repeats left out, in the order given. */
export function normalizeSourceIds(value: unknown): unknown {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return value;
  return [...new Set((value as string[]).map((v) => v.trim()).filter(Boolean))];
}

function sourceProblems(key: string, value: unknown, known: readonly string[]): SlotProblem[] {
  const normalized = normalizeSourceIds(value);
  if (!Array.isArray(normalized) || normalized.some((v) => typeof v !== 'string')) {
    return [{ code: 'schema_mismatch', message: `input "${key}" is not a list of source ids`, remedy: `Pass ${key} as ${describeSlot('source_ids')}.` }];
  }
  if (normalized.length === 0) return [{ code: 'schema_mismatch', message: `input "${key}" names no source`, remedy: `Pass ${key} as ${describeSlot('source_ids')}, or leave it out.` }];
  const unknownIds = (normalized as string[]).filter((id) => !known.includes(id));
  return unknownIds.map((id) => ({
    code: 'unavailable_source' as const,
    message: `input "${key}" names ${id}, which is not a declared active source`,
    remedy: `Declare it with sources action declare, or name one of: ${known.length ? known.join(', ') : '(none declared yet)'}.`,
  }));
}

// ---------------------------------------------------------------- checks and identity

/** What is wrong with a value of a kernel-typed input; empty when it is acceptable. */
export function checkSlot(type: SlotType, key: string, value: unknown, ctx: SlotContext): SlotProblem[] {
  if (type === 'source_ids') return sourceProblems(key, value, ctx.sourceIds);
  return periodProblems(key, value, ctx.at, ctx.timezone).map((message) => ({ code: 'schema_mismatch' as const, message, remedy: `Pass ${key} as ${describeSlot('period')}.` }));
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_k, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
}

/**
 * What makes two values the same piece of work: a period by its meaning,
 * dates and timezone (never when or how it was worked out); source ids as a
 * set. Anything not of the type is compared as written.
 */
export function slotIdentity(type: SlotType, value: unknown): string {
  if (type === 'source_ids') {
    const ids = normalizeSourceIds(value);
    return Array.isArray(ids) ? [...(ids as string[])].sort().join(',') : canonical(value);
  }
  if (isRecord(value) && typeof value.semantics === 'string' && typeof value.to === 'string' && typeof value.timezone === 'string' && (value.from === null || typeof value.from === 'string')) {
    return `${value.semantics}|${value.from ?? ''}|${value.to}|${value.timezone}`;
  }
  return canonical(value);
}
