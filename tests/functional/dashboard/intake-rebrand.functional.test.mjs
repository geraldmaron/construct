/**
 * tests/functional/dashboard/intake-rebrand.functional.test.mjs — /api/intake/*
 * returns profile-aware rebrand labels from getRebrand(ROOT_DIR).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDashboardServer } from '../_lib/dashboard-server.mjs';
import { getRebrand } from '../../../lib/profiles/rebrand.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('GET /api/intake/list returns active profile rebrand labels', { timeout: 60_000 }, async (t) => {
  const expected = getRebrand(REPO_ROOT);
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const res = await ds.fetch('/api/intake/list');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.label, expected.intakeQueueLabel);
  assert.equal(body.itemNoun, expected.signalNoun);
  assert.ok(typeof body.label === 'string' && body.label.length > 0);
  assert.ok(typeof body.itemNoun === 'string' && body.itemNoun.length > 0);
});

test('GET /api/intake/config includes rebrand labels', { timeout: 60_000 }, async (t) => {
  const expected = getRebrand(REPO_ROOT);
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const res = await ds.fetch('/api/intake/config');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.label, expected.intakeQueueLabel);
  assert.equal(body.itemNoun, expected.signalNoun);
});
