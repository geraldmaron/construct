/**
 * tests/kernel/registry/slots.test.ts — a period resolves from the calendar
 * into labeled dates in its timezone, is refused with the allowed forms when
 * it is malformed, and is identified by what it means; source ids must name
 * declared sources.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate } from '../../../src/kernel/calendar.ts';
import { isValidTimezone } from '../../../src/kernel/workflow/cron.ts';
import { checkSlot, dayOf, describeSlot, resolvePeriod, slotIdentity, type PeriodSpec } from '../../../src/kernel/registry/slots.ts';

const AT = '2026-10-08T12:00:00.000Z';
const ctx = { at: AT, sourceIds: ['jira', 'confluence'] };

function window(spec: PeriodSpec, at = AT, tz?: string): [string | null, string] {
  assert.deepEqual(checkSlot('period', 'period', spec, { ...ctx, at, timezone: tz }), [], JSON.stringify(spec));
  const r = resolvePeriod(spec, at, tz);
  return [r.from, r.to];
}

function refused(value: unknown, pattern: RegExp, at = AT): void {
  const problems = checkSlot('period', 'period', value, { ...ctx, at });
  assert.ok(problems.length > 0, `refused: ${JSON.stringify(value)}`);
  assert.equal(problems[0]!.code, 'schema_mismatch');
  assert.match(problems.map((p) => p.message).join(' | '), pattern);
  assert.match(problems[0]!.remedy, /semantics/);
}

test('relative periods are whole calendar units around today, labeled', () => {
  const s = (relative: PeriodSpec['relative'], extra: Partial<PeriodSpec> = {}): PeriodSpec => ({ semantics: 'changed_during', relative, ...extra });
  assert.deepEqual(window(s('last_quarter')), ['2026-07-01', '2026-09-30']);
  assert.deepEqual(window(s('this_quarter')), ['2026-10-01', '2026-12-31']);
  assert.equal(resolvePeriod(s('this_quarter'), AT).endsAfterToday, true, 'this_quarter is the whole quarter, which ends after today');
  assert.equal(resolvePeriod(s('last_quarter'), AT).endsAfterToday, false);
  assert.deepEqual(window(s('last_week')), ['2026-09-28', '2026-10-04']);
  assert.deepEqual(window(s('this_week')), ['2026-10-05', '2026-10-11']);
  assert.deepEqual(window(s('last_month')), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(window(s('this_month')), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(window(s('year_to_date')), ['2026-01-01', '2026-10-08']);
  assert.deepEqual(window(s('last_year')), ['2025-01-01', '2025-12-31']);
  assert.deepEqual(window(s('this_year')), ['2026-01-01', '2026-12-31']);
  assert.deepEqual(window(s('last_n_days', { n: 7 })), ['2026-10-02', '2026-10-08']);
  assert.deepEqual(window(s('last_n_days', { n: 30 })), ['2026-09-09', '2026-10-08']);
  assert.deepEqual(window(s('last_quarter'), '2026-02-10T09:00:00.000Z'), ['2025-10-01', '2025-12-31'], 'last quarter in Q1 is the previous year’s Q4');
  assert.deepEqual(window(s('last_month'), '2026-01-15T09:00:00.000Z'), ['2025-12-01', '2025-12-31']);

  const lq = resolvePeriod(s('last_quarter', { phrase: 'last quarter' }), AT);
  assert.equal(lq.how, 'relative');
  assert.equal(lq.relative, 'last_quarter');
  assert.equal(lq.phrase, 'last quarter');
  assert.equal(lq.timezone, 'UTC');
  assert.equal(lq.resolvedAt, AT);
  assert.ok(lq.assumptions.includes('dates are in UTC'));
  assert.ok(lq.assumptions.includes('quarters are calendar quarters'));
  assert.ok(resolvePeriod(s('last_week'), AT).assumptions.includes('weeks run Monday to Sunday'));
  assert.ok(resolvePeriod(s('last_n_days', { n: 7 }), AT).assumptions.includes('last_n_days counts today'));
  assert.ok(resolvePeriod(s('this_quarter'), AT).assumptions.some((a) => /ends after today \(2026-10-08\)/.test(a)));
});

test('a quarter without a year is the most recent one that has started; a year alone is the whole year', () => {
  const q3 = resolvePeriod({ semantics: 'evidence_window', quarter: 3 }, AT);
  assert.deepEqual([q3.from, q3.to, q3.how, q3.quarter, q3.year], ['2026-07-01', '2026-09-30', 'quarter', 3, 2026]);
  assert.ok(q3.assumptions.some((a) => a.startsWith('Q3 taken as 2026')), q3.assumptions.join('; '));
  const q4 = resolvePeriod({ semantics: 'evidence_window', quarter: 4 }, '2026-08-15T12:00:00.000Z');
  assert.deepEqual([q4.from, q4.to, q4.year], ['2025-10-01', '2025-12-31', 2025]);
  assert.ok(q4.assumptions.some((a) => a.startsWith('Q4 taken as 2025')));
  const q4now = resolvePeriod({ semantics: 'evidence_window', quarter: 4 }, AT);
  assert.equal(q4now.year, 2026, 'on 2026-10-08 Q4 has started');
  assert.equal(q4now.endsAfterToday, true);
  const given = resolvePeriod({ semantics: 'changed_during', quarter: 1, year: 2027 }, AT);
  assert.deepEqual([given.from, given.to], ['2027-01-01', '2027-03-31']);
  assert.ok(!given.assumptions.some((a) => /taken as/.test(a)), 'a quarter with its year assumes no year');

  assert.deepEqual(window({ semantics: 'changed_during', year: 2028 }), ['2028-01-01', '2028-12-31']);
  assert.equal(resolvePeriod({ semantics: 'changed_during', year: 2028 }, AT).how, 'year');
  assert.deepEqual(window({ semantics: 'changed_during', from: '2028-02-01', to: '2028-02-29' }), ['2028-02-01', '2028-02-29'], 'a leap day is a real date');
  refused({ semantics: 'changed_during', from: '2027-02-01', to: '2027-02-29' }, /2027-02-29.*not a real date/);
  refused({ semantics: 'changed_during', from: '2026-02-30', to: '2026-03-01' }, /not a real date/);
});

test('the timezone is the period’s own, else the caller’s, else UTC', () => {
  const at = '2026-10-01T02:00:00.000Z';
  assert.deepEqual(window({ semantics: 'changed_during', relative: 'this_quarter' }, at), ['2026-10-01', '2026-12-31']);
  assert.deepEqual(window({ semantics: 'changed_during', relative: 'this_quarter', timezone: 'America/Los_Angeles' }, at), ['2026-07-01', '2026-09-30'], 'it is still September 30 in Los Angeles');
  assert.deepEqual(window({ semantics: 'changed_during', relative: 'this_quarter' }, at, 'America/Los_Angeles'), ['2026-07-01', '2026-09-30'], 'the caller’s timezone');
  assert.deepEqual(window({ semantics: 'changed_during', relative: 'this_quarter', timezone: 'UTC' }, at, 'America/Los_Angeles'), ['2026-10-01', '2026-12-31'], 'the period’s own wins');
  const r = resolvePeriod({ semantics: 'changed_during', relative: 'this_quarter' }, at, 'America/Los_Angeles');
  assert.equal(r.timezone, 'America/Los_Angeles');
  assert.ok(r.assumptions.includes('dates are in America/Los_Angeles'));
  refused({ semantics: 'changed_during', relative: 'last_week', timezone: 'Mars/Olympus' }, /not an IANA timezone/);
});

test('as_of keeps only the end date, and an end after today is taken as of today', () => {
  const q = resolvePeriod({ semantics: 'as_of', relative: 'last_quarter' }, AT);
  assert.deepEqual([q.from, q.to, q.endsAfterToday], [null, '2026-09-30', false]);
  assert.ok(q.assumptions.includes('as_of keeps only the end date'));
  const d = resolvePeriod({ semantics: 'as_of', to: '2026-09-30' }, AT);
  assert.deepEqual([d.from, d.to, d.how], [null, '2026-09-30', 'dates']);
  const w = resolvePeriod({ semantics: 'as_of', from: '2026-07-01', to: '2026-09-30' }, AT);
  assert.equal(w.from, null, 'a window becomes its end');
  const now = resolvePeriod({ semantics: 'as_of', relative: 'this_quarter' }, AT);
  assert.deepEqual([now.to, now.endsAfterToday], ['2026-10-08', false]);
  assert.ok(now.assumptions.some((a) => /as of today \(2026-10-08\)/.test(a)));
});

test('a malformed period is refused with what it takes', () => {
  refused({ semantics: 'changed_during', relative: 'last_quarter', from: '2026-07-02', to: '2026-09-30' }, /last_quarter on 2026-10-08 \(UTC\) runs from 2026-07-01 to 2026-09-30/);
  refused({ semantics: 'changed_during', quarter: 3, year: 2026, to: '2026-10-31' }, /Q3 2026 .* runs from 2026-07-01 to 2026-09-30/);
  assert.deepEqual(checkSlot('period', 'period', { semantics: 'changed_during', relative: 'last_quarter', from: '2026-07-01', to: '2026-09-30' }, ctx), [], 'agreeing dates may accompany relative');
  assert.deepEqual(checkSlot('period', 'period', { semantics: 'as_of', relative: 'this_quarter', to: '2026-10-08' }, ctx), [], 'as_of may give today as the end of a unit that runs past it');
  refused({ semantics: 'changed_during', from: '2026-09-30', to: '2026-07-01' }, /from must not be after to/);
  refused({ semantics: 'changed_during', relative: 'last_week', n: 3 }, /only last_n_days takes/);
  refused({ semantics: 'changed_during', relative: 'last_n_days' }, /without "n"/);
  refused({ semantics: 'changed_during', relative: 'last_n_days', n: 0 }, /from 1 to 3660/);
  refused({ semantics: 'changed_during', relative: 'last_n_days', n: 3661 }, /from 1 to 3660/);
  assert.deepEqual(checkSlot('period', 'period', { semantics: 'changed_during', relative: 'last_n_days', n: 3660 }, ctx), []);
  refused({ semantics: 'during', relative: 'last_week' }, /one of as_of, changed_during, evidence_window/);
  refused({ relative: 'last_week' }, /needs "semantics"/);
  refused({ semantics: 'changed_during', relative: 'last_week', window: 'x' }, /"window", which a period does not take/);
  refused({ semantics: 'changed_during', relative: 'last_fortnight' }, /relative is one of this_week/);
  refused({ semantics: 'changed_during', quarter: 5 }, /quarter is 1, 2, 3 or 4/);
  refused({ semantics: 'changed_during', year: 26 }, /four-digit/);
  refused({ semantics: 'changed_during', relative: 'last_week', quarter: 3 }, /give one way/);
  refused({ semantics: 'changed_during' }, /names no period/);
  refused({ semantics: 'changed_during', to: '2026-09-30' }, /needs both dates/);
  refused({ semantics: 'changed_during', from: '2026-07-01' }, /without to/);
  refused('Q3', /is string, not a period/);
  refused(null, /is null, not a period/);
  assert.throws(() => resolvePeriod({ semantics: 'nope' } as unknown as PeriodSpec, AT), /semantics/);
});

test('source ids must name declared active sources', () => {
  assert.deepEqual(checkSlot('source_ids', 'sources', ['jira', ' confluence ', 'jira'], ctx), [], 'whitespace and repeats are normalized, not refused');
  const unknown = checkSlot('source_ids', 'sources', ['jira', 'datadog'], ctx);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0]!.code, 'unavailable_source');
  assert.match(unknown[0]!.message, /datadog, which is not a declared active source/);
  assert.match(unknown[0]!.remedy, /Declare it with sources action declare, or name one of: jira, confluence/);
  assert.equal(checkSlot('source_ids', 'sources', 'jira', ctx)[0]!.code, 'schema_mismatch');
  assert.equal(checkSlot('source_ids', 'sources', [], ctx)[0]!.code, 'schema_mismatch');
  assert.equal(checkSlot('source_ids', 'sources', [' '], ctx)[0]!.code, 'schema_mismatch');
  assert.match(describeSlot('source_ids'), /declared source ids/);
});

test('a period is identified by its meaning, not by when or how it was worked out', () => {
  const a = resolvePeriod({ semantics: 'changed_during', relative: 'last_quarter', phrase: 'last quarter' }, AT);
  const b = resolvePeriod({ semantics: 'changed_during', relative: 'last_quarter' }, '2026-11-20T08:00:00.000Z');
  const c = resolvePeriod({ semantics: 'changed_during', quarter: 3, year: 2026 }, AT);
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(slotIdentity('period', a), 'changed_during|2026-07-01|2026-09-30|UTC');
  assert.equal(slotIdentity('period', b), slotIdentity('period', a), 'two days in one quarter');
  assert.equal(slotIdentity('period', c), slotIdentity('period', a), 'the same window named another way');
  assert.equal(slotIdentity('period', reordered), slotIdentity('period', a), 'key order');
  assert.notEqual(slotIdentity('period', resolvePeriod({ semantics: 'evidence_window', relative: 'last_quarter' }, AT)), slotIdentity('period', a), 'another meaning is other work');
  assert.notEqual(slotIdentity('period', resolvePeriod({ semantics: 'changed_during', relative: 'last_quarter', timezone: 'Asia/Tokyo' }, AT)), slotIdentity('period', a), 'another timezone is other work');
  assert.equal(slotIdentity('period', resolvePeriod({ semantics: 'as_of', to: '2026-09-30' }, AT)), 'as_of||2026-09-30|UTC');
  assert.equal(slotIdentity('source_ids', ['jira', 'confluence', 'jira']), slotIdentity('source_ids', ['confluence', 'jira']));
});

test('the calendar gives the date an instant falls on in a timezone, and cron still knows timezones', () => {
  assert.equal(calendarDate('2026-10-01T02:00:00.000Z', 'America/Los_Angeles'), '2026-09-30');
  assert.equal(calendarDate('2026-10-01T02:00:00.000Z', 'UTC'), '2026-10-01');
  assert.equal(calendarDate('2026-12-31T23:30:00.000Z', 'Asia/Tokyo'), '2027-01-01');
  assert.equal(dayOf('2026-10-05T23:30:00Z', 'Europe/Berlin'), '2026-10-06');
  assert.equal(dayOf('2026-10-05', 'America/Los_Angeles'), '2026-10-05', 'a bare date is that date anywhere');
  assert.equal(dayOf('2026-10-05T23:30:00', 'America/Los_Angeles'), '2026-10-05', 'a time written without a zone is on the date it shows, on any machine');
  assert.equal(dayOf('2026-10-05 23:30', 'Asia/Tokyo'), '2026-10-05');
  assert.equal(dayOf('2026-10-05T23:30:00.000+0000', 'Europe/Berlin'), '2026-10-06', 'a time with an offset is placed in the timezone');
  assert.equal(dayOf('not a time', 'UTC'), null);
  assert.equal(dayOf('2027-02-29', 'UTC'), null);
  assert.equal(isValidTimezone('Europe/Berlin'), true);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
});
