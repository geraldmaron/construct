/**
 * tests/doctor/audit.test.mjs — doctor audit log behavior.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let audit;
test.before(async () => {
  process.env.CONSTRUCT_DOCTOR_ROOT = tempDir('construct-doctor-audit-');
  audit = await import('../../lib/doctor/audit.mjs');
});

test.beforeEach(() => {
  const p = audit._paths.logPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

test('record appends a single JSONL line', () => {
  const entry = audit.record({ kind: 'action', watcher: 'disk', action: 'rotate', target: 'events.jsonl', summary: 'dropped 50' });
  assert.equal(entry.kind, 'action');
  assert.equal(entry.watcher, 'disk');
  const lines = audit.recent({ watcher: 'disk' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].action, 'rotate');
});

test('recent filters by watcher, kind, and respects limit', () => {
  audit.record({ kind: 'sample', watcher: 'cost', summary: 's1' });
  audit.record({ kind: 'sample', watcher: 'cost', summary: 's2' });
  audit.record({ kind: 'action', watcher: 'disk', summary: 'd1' });
  assert.equal(audit.recent({ watcher: 'cost' }).length, 2);
  assert.equal(audit.recent({ kind: 'action' }).length, 1);
  assert.equal(audit.recent({ limit: 1 }).length, 1);
});

test('summary is truncated to 2048 chars', () => {
  const big = 'x'.repeat(5000);
  const e = audit.record({ kind: 'sample', watcher: 'd', summary: big });
  assert.equal(e.summary.length, 2048);
});
