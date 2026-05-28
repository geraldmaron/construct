/**
 * tests/hooks/specialist-agent.test.mjs — Verify the agent-active detector
 * that gates pre-push-gate.mjs's hard-block vs warn-only behavior.
 *
 * Exercises every input axis: explicit env flag, fresh per-agent file, fresh
 * shared file, stale file (outside 10-min window), missing file, malformed
 * JSON.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSpecialistAgentActive } from '../../lib/hooks/_lib/specialist-agent.mjs';

const FRESH = '2026-05-28T10:00:00.000Z';
const FRESH_MS = Date.parse(FRESH);
const TEN_MIN = 10 * 60 * 1000;

function makeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'sa-'));
  mkdirSync(join(dir, '.cx'), { recursive: true });
  return {
    dir,
    home: () => dir,
    writeLastAgent(filename, payload) {
      writeFileSync(join(dir, '.cx', filename), JSON.stringify(payload));
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test('CONSTRUCT_AGENT_ID set => active', () => {
  const h = makeHome();
  try {
    assert.equal(
      isSpecialistAgentActive({ env: { CONSTRUCT_AGENT_ID: 'cx-engineer' }, home: h.home, now: () => FRESH_MS }),
      true,
    );
  } finally { h.cleanup(); }
});

test('no env, no tracker files => inactive', () => {
  const h = makeHome();
  try {
    assert.equal(isSpecialistAgentActive({ env: {}, home: h.home, now: () => FRESH_MS }), false);
  } finally { h.cleanup(); }
});

test('fresh shared last-agent.json => active', () => {
  const h = makeHome();
  try {
    h.writeLastAgent('last-agent.json', { agent: 'cx-engineer', ts: FRESH });
    assert.equal(isSpecialistAgentActive({ env: {}, home: h.home, now: () => FRESH_MS + 60_000 }), true);
  } finally { h.cleanup(); }
});

test('stale shared last-agent.json (>10min) => inactive', () => {
  const h = makeHome();
  try {
    h.writeLastAgent('last-agent.json', { agent: 'cx-engineer', ts: FRESH });
    assert.equal(isSpecialistAgentActive({ env: {}, home: h.home, now: () => FRESH_MS + TEN_MIN + 1_000 }), false);
  } finally { h.cleanup(); }
});

test('per-agent file takes precedence over shared file', () => {
  const h = makeHome();
  try {
    // Shared is stale, per-agent is fresh -> active
    h.writeLastAgent('last-agent.json', { agent: 'cx-architect', ts: '2020-01-01T00:00:00.000Z' });
    h.writeLastAgent('last-agent-engineer.json', { agent: 'cx-engineer', ts: FRESH });
    assert.equal(
      isSpecialistAgentActive({
        env: { CONSTRUCT_AGENT_ID: 'cx-engineer' },
        home: h.home,
        now: () => FRESH_MS + 60_000,
      }),
      true,
    );
  } finally { h.cleanup(); }
});

test('malformed tracker JSON => inactive, does not throw', () => {
  const h = makeHome();
  try {
    writeFileSync(join(h.dir, '.cx', 'last-agent.json'), 'not json');
    assert.equal(isSpecialistAgentActive({ env: {}, home: h.home, now: () => FRESH_MS }), false);
  } finally { h.cleanup(); }
});

test('tracker entry without ts => inactive', () => {
  const h = makeHome();
  try {
    h.writeLastAgent('last-agent.json', { agent: 'cx-engineer' });
    assert.equal(isSpecialistAgentActive({ env: {}, home: h.home, now: () => FRESH_MS }), false);
  } finally { h.cleanup(); }
});
