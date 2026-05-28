/**
 * tests/extractors/calendar.test.mjs — ICS calendar structured extraction tests.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractCalendar } from '../../lib/extractors/calendar.mjs';

const TMP = join(tmpdir(), `construct-calendar-test-${Date.now()}`);

before(() => mkdirSync(TMP, { recursive: true }));
after(() => rmSync(TMP, { recursive: true, force: true }));

function write(name, content) {
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

const SINGLE_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
SUMMARY:Team Standup
DTSTART:20240115T090000Z
DTEND:20240115T093000Z
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;CN=Bob:mailto:bob@example.com
ATTENDEE;CN=Carol:mailto:carol@example.com
DESCRIPTION:Daily standup meeting\\nBring your update.
LOCATION:Conference Room A
END:VEVENT
END:VCALENDAR`;

const MULTI_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Sprint Planning
DTSTART:20240201T100000Z
DTEND:20240201T120000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Retrospective
DTSTART:20240215T140000Z
DTEND:20240215T150000Z
END:VEVENT
END:VCALENDAR`;

const RECURRING_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Weekly Review
DTSTART:20240101T100000Z
DTEND:20240101T110000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
END:VCALENDAR`;

describe('ICS calendar extraction', () => {
  it('extracts a single VEVENT', () => {
    const p = write('single.ics', SINGLE_EVENT_ICS);
    const result = extractCalendar(p);
    assert.equal(result.structured.events.length, 1);
    const event = result.structured.events[0];
    assert.equal(event.summary, 'Team Standup');
    assert.equal(event.dtstart, '2024-01-15T09:00:00Z');
    assert.equal(event.dtend, '2024-01-15T09:30:00Z');
    assert.equal(event.organizer, 'Alice');
    assert.deepEqual(event.attendees, ['Bob', 'Carol']);
    assert.ok(event.description.includes('Daily standup meeting'));
    assert.equal(event.location, 'Conference Room A');
    assert.deepEqual(result.droppedInfo, []);
  });

  it('extracts multiple VEVENTs', () => {
    const p = write('multi.ics', MULTI_EVENT_ICS);
    const result = extractCalendar(p);
    assert.equal(result.structured.events.length, 2);
    assert.equal(result.structured.events[0].summary, 'Sprint Planning');
    assert.equal(result.structured.events[1].summary, 'Retrospective');
  });

  it('preserves RRULE for recurring events', () => {
    const p = write('recurring.ics', RECURRING_EVENT_ICS);
    const result = extractCalendar(p);
    assert.equal(result.structured.events[0].rrule, 'FREQ=WEEKLY;BYDAY=MO');
  });

  it('produces text representation with key fields', () => {
    const p = write('text.ics', SINGLE_EVENT_ICS);
    const result = extractCalendar(p);
    assert.ok(result.text.includes('Team Standup'));
    assert.ok(result.text.includes('Alice'));
  });

  it('emits droppedInfo for non-empty file without VCALENDAR', () => {
    const p = write('invalid.ics', 'This is not an ICS file at all');
    const result = extractCalendar(p);
    assert.equal(result.structured, null);
    assert.equal(result.droppedInfo.length, 1);
  });

  it('handles multi-line property continuation (RFC 5545 unfolding)', () => {
    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Long Summar\n y Name\nDTSTART:20240101T090000Z\nEND:VEVENT\nEND:VCALENDAR`;
    const p = write('folded.ics', ics);
    const result = extractCalendar(p);
    assert.equal(result.structured.events[0].summary, 'Long Summary Name');
  });
});
