/**
 * lib/extractors/calendar.mjs — RFC 5545 iCalendar (.ics) structured extraction.
 *
 * Parses VCALENDAR / VEVENT blocks without external dependencies. Handles
 * multi-line property continuation (lines starting with whitespace), extracts
 * SUMMARY, DTSTART, DTEND, ORGANIZER, ATTENDEE, DESCRIPTION, LOCATION, and
 * preserves RRULE as a raw string for recurring events.
 *
 * Returns the universal { text, structured, droppedInfo } envelope where
 * structured = { events: [{ summary, dtstart, dtend, organizer,
 *                           attendees: [], description, location, rrule }] }.
 */
import { readFileSync } from 'node:fs';
import { makeEnvelope, makeDropInfo } from './shared/drop-info.mjs';

// ─── RFC 5545 helpers ─────────────────────────────────────────────────────────

// Unfold continuation lines (RFC 5545 §3.1 — a line beginning with SPACE or TAB
// is a continuation of the previous property line).
function unfoldLines(raw) {
  return raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

// Split a property line into its name, params object, and value.
// e.g. "DTSTART;TZID=America/New_York:20240101T090000" → name=DTSTART, params={TZID:...}, value=...
function parseProperty(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return { name: line.toUpperCase(), params: {}, value: '' };
  const nameAndParams = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).trim();
  const parts = nameAndParams.split(';');
  const name = (parts[0] || '').toUpperCase().trim();
  const params = {};
  for (const part of parts.slice(1)) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    params[part.slice(0, eqIdx).toUpperCase()] = part.slice(eqIdx + 1);
  }
  return { name, params, value };
}

// Extract a human-readable name from an ORGANIZER or ATTENDEE value.
// Tries the CN param first, then strips mailto: prefix.
function extractName(value, params) {
  if (params.CN) return params.CN.replace(/^["']|["']$/g, '');
  return value.replace(/^mailto:/i, '');
}

// Parse an iCal date/datetime string into an ISO string. Tolerant of both
// date-only (YYYYMMDD) and datetime (YYYYMMDDTHHMMSS[Z]) forms.
function parseIcalDate(value) {
  if (!value) return null;
  const v = value.replace('Z', '').trim();
  if (v.length === 8) {
    // Date-only: YYYYMMDD
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  if (v.length >= 15 && v[8] === 'T') {
    // Datetime: YYYYMMDDTHHMMSS
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}${value.endsWith('Z') ? 'Z' : ''}`;
  }
  return value;
}

// ─── VEVENT block parser ──────────────────────────────────────────────────────

function parseVEvent(lines) {
  const event = {
    summary: null,
    dtstart: null,
    dtend: null,
    organizer: null,
    attendees: [],
    description: null,
    location: null,
    rrule: null,
  };

  for (const line of lines) {
    if (!line.includes(':')) continue;
    const { name, params, value } = parseProperty(line);
    switch (name) {
      case 'SUMMARY':     event.summary = value; break;
      case 'DTSTART':     event.dtstart = parseIcalDate(value); break;
      case 'DTEND':       event.dtend   = parseIcalDate(value); break;
      case 'DTDUE':       event.dtend   = event.dtend ?? parseIcalDate(value); break;
      case 'ORGANIZER':   event.organizer = extractName(value, params); break;
      case 'ATTENDEE':    event.attendees.push(extractName(value, params)); break;
      case 'DESCRIPTION': event.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ','); break;
      case 'LOCATION':    event.location = value; break;
      case 'RRULE':       event.rrule = value; break;
    }
  }
  return event;
}

// ─── VCALENDAR parser ─────────────────────────────────────────────────────────

function parseIcs(raw) {
  const unfolded = unfoldLines(raw);
  const lines = unfolded.split('\n').map((l) => l.trim()).filter(Boolean);

  if (!lines.some((l) => l === 'BEGIN:VCALENDAR')) {
    return makeEnvelope({
      text: raw.replace(/\r\n/g, '\n').trim(),
      structured: null,
      droppedInfo: [makeDropInfo({ kind: 'attachment', count: 1, reason: 'No BEGIN:VCALENDAR found; treating as plain text', recoverable: false })],
    });
  }

  const events = [];
  let inEvent = false;
  let eventLines = [];
  let droppedTodosVjournals = 0;
  let inOther = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      eventLines = [];
    } else if (line === 'END:VEVENT') {
      events.push(parseVEvent(eventLines));
      inEvent = false;
    } else if (line === 'BEGIN:VTODO' || line === 'BEGIN:VJOURNAL') {
      inOther = true;
      droppedTodosVjournals++;
    } else if (line === 'END:VTODO' || line === 'END:VJOURNAL') {
      inOther = false;
    } else if (inEvent) {
      eventLines.push(line);
    }
  }

  const droppedInfo = [];
  if (droppedTodosVjournals > 0) {
    droppedInfo.push(makeDropInfo({
      kind: 'attachment',
      count: droppedTodosVjournals,
      reason: 'VTODO and VJOURNAL components omitted (only VEVENT extracted)',
      recoverable: false,
    }));
  }

  // Build text representation
  const textParts = events.map((e) => {
    const parts = [];
    if (e.summary) parts.push(`Event: ${e.summary}`);
    if (e.dtstart) parts.push(`Start: ${e.dtstart}`);
    if (e.dtend)   parts.push(`End: ${e.dtend}`);
    if (e.organizer) parts.push(`Organizer: ${e.organizer}`);
    if (e.attendees.length) parts.push(`Attendees: ${e.attendees.join(', ')}`);
    if (e.location) parts.push(`Location: ${e.location}`);
    if (e.description) parts.push(`\n${e.description}`);
    return parts.join('\n');
  });

  return makeEnvelope({
    text: textParts.join('\n\n').trim(),
    structured: { events },
    droppedInfo,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract structured calendar data from a .ics file path.
 * Returns the universal { text, structured, droppedInfo } envelope.
 */
export function extractCalendar(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  return parseIcs(raw);
}
