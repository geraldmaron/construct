/**
 * tests/intake-attribution.test.mjs — provenance metadata unit tests.
 *
 * Verifies the agent-identity precedence, the CONSTRUCT_ATTRIBUTION_DISABLE
 * escape hatch, and the stamp/touch helpers that intake artifacts call.
 * Git-config-derived human identity is not asserted here because the test
 * environment cannot guarantee a clean git config; the disabled path
 * exercises the deterministic shape instead.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  gatherAttribution,
  stampAttribution,
  touchAttribution,
} from '../lib/intake/attribution.mjs';

let saved;

beforeEach(() => {
  saved = {
    CONSTRUCT_ATTRIBUTION_DISABLE: process.env.CONSTRUCT_ATTRIBUTION_DISABLE,
    CONSTRUCT_AGENT_ID: process.env.CONSTRUCT_AGENT_ID,
    CLAUDE_AGENT_ID: process.env.CLAUDE_AGENT_ID,
  };
  delete process.env.CONSTRUCT_AGENT_ID;
  delete process.env.CLAUDE_AGENT_ID;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('gatherAttribution returns null identities and a timestamp when disabled', () => {
  process.env.CONSTRUCT_ATTRIBUTION_DISABLE = '1';
  const now = new Date('2026-05-29T19:00:00.000Z');
  const a = gatherAttribution({ now });
  assert.equal(a.createdBy, null);
  assert.equal(a.createdByAgent, null);
  assert.equal(a.createdAt, '2026-05-29T19:00:00.000Z');
});

test('CONSTRUCT_AGENT_ID takes precedence over CLAUDE_AGENT_ID', () => {
  process.env.CONSTRUCT_ATTRIBUTION_DISABLE = '1';
  process.env.CONSTRUCT_AGENT_ID = 'construct-primary';
  process.env.CLAUDE_AGENT_ID = 'claude-fallback';
  delete process.env.CONSTRUCT_ATTRIBUTION_DISABLE;
  const a = gatherAttribution();
  assert.equal(a.createdByAgent, 'construct-primary');
});

test('CLAUDE_AGENT_ID is used when CONSTRUCT_AGENT_ID is absent', () => {
  process.env.CLAUDE_AGENT_ID = 'claude-opus-4-7';
  const a = gatherAttribution();
  assert.equal(a.createdByAgent, 'claude-opus-4-7');
});

test('stampAttribution adds createdBy / createdByAgent / createdAt to a record', () => {
  const stamped = stampAttribution(
    { intakeId: 'i-1' },
    { createdBy: 'Test <t@e.com>', createdByAgent: 'claude-opus-4-7', createdAt: '2026-05-29T19:00:00.000Z' },
  );
  assert.equal(stamped.intakeId, 'i-1');
  assert.equal(stamped.createdBy, 'Test <t@e.com>');
  assert.equal(stamped.createdByAgent, 'claude-opus-4-7');
  assert.equal(stamped.createdAt, '2026-05-29T19:00:00.000Z');
});

test('touchAttribution adds lastModifiedBy fields without overwriting createdBy', () => {
  const initial = stampAttribution(
    { intakeId: 'i-1' },
    { createdBy: 'Alice', createdByAgent: 'codex', createdAt: '2026-01-01T00:00:00.000Z' },
  );
  const touched = touchAttribution(initial, {
    createdBy: 'Bob',
    createdByAgent: 'claude',
    createdAt: '2026-05-29T19:00:00.000Z',
  });
  assert.equal(touched.createdBy, 'Alice', 'createdBy must not be overwritten');
  assert.equal(touched.lastModifiedBy, 'Bob');
  assert.equal(touched.lastModifiedByAgent, 'claude');
  assert.equal(touched.lastModifiedAt, '2026-05-29T19:00:00.000Z');
});

test('stampAttribution is a no-op for null or non-object inputs', () => {
  assert.equal(stampAttribution(null), null);
  assert.equal(stampAttribution('string'), 'string');
});
