/**
 * tests/roles/event-bus.test.mjs — append-only event log behavior.
 *
 * Tests are isolated via CONSTRUCT_ROLES_ROOT pointing at a tempdir.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let bus;
test.before(async () => {
  process.env.CONSTRUCT_ROLES_ROOT = tempDir('construct-roles-bus-');
  bus = await import('../../lib/roles/event-bus.mjs');
});

test.beforeEach(() => {
  const ep = bus._paths.eventsPath();
  if (fs.existsSync(ep)) fs.unlinkSync(ep);
});

test('fingerprint is stable for same input', () => {
  const a = bus.fingerprintOf('test.fail', 'proj', 'line one\nline two');
  const b = bus.fingerprintOf('test.fail', 'proj', 'line one\nignored');
  const c = bus.fingerprintOf('test.fail', 'proj-other', 'line one');
  assert.equal(a, b, 'first line drives fingerprint');
  assert.notEqual(a, c, 'project changes fingerprint');
});

test('emit appends a JSONL line and recent reads it back', () => {
  const entry = bus.emit('test.fail', { project: 'p', summary: 'boom' });
  assert.ok(entry.fingerprint);
  const lines = bus.recent({ type: 'test.fail' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, 'test.fail');
  assert.equal(lines[0].summary, 'boom');
});

test('recent filters by fingerprint and limit', () => {
  bus.emit('a.b', { project: 'p', summary: 's1' });
  bus.emit('a.b', { project: 'p', summary: 's1' });
  bus.emit('a.b', { project: 'p', summary: 's2' });
  const fp = bus.fingerprintOf('a.b', 'p', 's1');
  const matches = bus.recent({ fingerprint: fp });
  assert.equal(matches.length, 2);
  assert.equal(bus.recent({ limit: 1 }).length, 1);
});

test('rotation trims at 1000 lines', () => {
  for (let i = 0; i < 1050; i++) {
    bus.emit('rot.test', { project: 'p', summary: `s${i}` });
  }
  const lines = fs.readFileSync(bus._paths.eventsPath(), 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.length <= 1000, `expected <=1000, got ${lines.length}`);
});
