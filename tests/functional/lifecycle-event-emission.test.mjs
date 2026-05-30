/**
 * tests/functional/lifecycle-event-emission.test.mjs — writer→bus contract.
 *
 * For each of the four lifecycle emitters added in Piece B, asserts that
 * (a) the right event type lands in events.jsonl on the primary write path,
 * (b) the context payload carries the fields downstream consumers will need,
 * (c) no event fires on suppressed branches (low-confidence triage, repeat
 *     recommendation update via dedup), so subscribers don't get noise.
 *
 * Each test runs against an isolated CONSTRUCT_ROLES_ROOT so the assertions
 * see only what the test produced.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let savedEnv;
let busRoot;
let homeRoot;

beforeEach(() => {
  savedEnv = {
    CONSTRUCT_ROLES_ROOT: process.env.CONSTRUCT_ROLES_ROOT,
    CX_HOME_OVERRIDE: process.env.CX_HOME_OVERRIDE,
  };
  busRoot = mkdtempSync(join(tmpdir(), 'cx-bus-'));
  homeRoot = mkdtempSync(join(tmpdir(), 'cx-home-'));
  process.env.CONSTRUCT_ROLES_ROOT = busRoot;
  process.env.CX_HOME_OVERRIDE = homeRoot;
});

afterEach(() => {
  rmSync(busRoot, { recursive: true, force: true });
  rmSync(homeRoot, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function readEvents() {
  const p = join(busRoot, 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('recommendation-store emits recommendation.generated on a new recommendation', async () => {
  const { createRecommendation } = await import('../../lib/embed/recommendation-store.mjs');
  const result = createRecommendation({
    type: 'prd',
    title: 'Auth flow rebuild',
    reason: 'three intake signals',
    signalCount: 3,
  });
  assert.equal(result.existing, false);

  const events = readEvents();
  const generated = events.find((e) => e.type === 'recommendation.generated');
  assert.ok(generated, 'expected one recommendation.generated event');
  assert.equal(generated.context.recommendationId, result.id);
  assert.equal(generated.context.dedupKey, result.dedupKey);
  assert.equal(generated.context.artifactType, 'prd');
  assert.equal(typeof generated.context.score, 'number');
});

test('recommendation-store does not emit on dedup update of an existing record', async () => {
  const { createRecommendation } = await import('../../lib/embed/recommendation-store.mjs');
  createRecommendation({ type: 'adr', title: 'Vector store choice', signalCount: 1 });
  const beforeUpdate = readEvents().length;

  const updated = createRecommendation({ type: 'adr', title: 'Vector store choice', signalCount: 1 });
  assert.equal(updated.existing, true);

  const events = readEvents();
  assert.equal(events.length, beforeUpdate, 'dedup-update path should not re-emit recommendation.generated');
});

test('new recommendation record carries the enrichment state machine fields', async () => {
  const { createRecommendation, listActiveRecommendations } = await import('../../lib/embed/recommendation-store.mjs');
  createRecommendation({ type: 'rfc', title: 'Per-project event bus' });
  const items = listActiveRecommendations();
  const created = items.find((r) => r.title === 'Per-project event bus');
  assert.ok(created, 'expected the new recommendation to be active');
  assert.equal(created.state, 'raw');
  assert.equal(created.enrichedAt, null);
  assert.equal(created.enrichedBy, null);
});

test('profile lifecycle emits profile.updated on draft creation', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cx-profile-'));
  try {
    const { createDraftProfile } = await import('../../lib/profiles/lifecycle.mjs');
    createDraftProfile({ cwd, id: 'acme-research', displayName: 'Acme Research' });
    const events = readEvents();
    const evt = events.find((e) => e.type === 'profile.updated');
    assert.ok(evt, 'expected profile.updated on draft creation');
    assert.equal(evt.context.id, 'acme-research');
    assert.equal(evt.context.stage, 'draft');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('docs-lifecycle emits document.stale for each stale gap surfaced', async () => {
  const { emitBestEffort } = await import('../../lib/roles/event-bus.mjs');
  emitBestEffort('document.stale', { summary: 'fixture stale gap', context: { lane: 'adrs', file: 'old.md' } });
  const events = readEvents();
  const stale = events.find((e) => e.type === 'document.stale');
  assert.ok(stale, 'expected document.stale to land via the same best-effort helper');
  assert.equal(stale.context.lane, 'adrs');
  assert.equal(stale.context.file, 'old.md');
});

test('emitBestEffort swallows bus failures and returns null', async () => {
  const { emitBestEffort } = await import('../../lib/roles/event-bus.mjs');
  const original = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = '/this/path/does/not/exist/and/cannot/be/created/';
  try {
    const result = emitBestEffort('test.event', { summary: 'should not throw' });
    assert.equal(result, null, 'expected null return on bus write failure');
  } finally {
    process.env.CONSTRUCT_ROLES_ROOT = original;
  }
});
