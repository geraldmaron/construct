/**
 * tests/functional/team-vs-solo-comparison.functional.test.mjs — construct-72gqn.18 (L5).
 *
 * Proves the baseline comparison is real: the same request run through the base chain covers
 * every role concern (architecture, implementation, review, testing) while a single solo call
 * covers only what one generalist reaches, and the comparison — deltas and a stated verdict —
 * is recorded to the comparisons store. This is what makes orchestration's added cost earned
 * rather than assumed. Also pins the deterministic coverage rubric directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTeamVsSoloComparison, scoreRoleConcernCoverage, comparisonsDir } from '../../lib/certification/comparisons.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test-abcdef0123456789' };

const dirs = [];
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-l5-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-l5-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

test('scoreRoleConcernCoverage counts distinct role concerns present in text', () => {
  assert.equal(scoreRoleConcernCoverage('the key trade-off; implement the pattern; an edge case failure mode; add a test').count, 4);
  assert.equal(scoreRoleConcernCoverage('I implemented a token bucket.').count, 1);
  assert.equal(scoreRoleConcernCoverage('hello world').count, 0);
});

test('the base chain covers more role concerns than a solo call, and the comparison is recorded', async () => {
  const rootDir = project();
  const TEAM = [
    'ARCHITECT: the key trade-off is per-tenant fairness vs throughput; the invariant is revocability.',
    'ENGINEER: implement a token-bucket following the existing rate-limit pattern in the module.',
    'REVIEWER: the edge case of clock skew is a failure mode; error handling for bursts is missing — a real risk.',
    'QA: add a test asserting fairness and coverage of the burst acceptance criteria.',
  ];
  const SOLO = 'SOLO: I implemented a token bucket and shipped it.';
  let teamIdx = 0;
  const fetchImpl = async (_url, opts) => {
    const body = String(opts.body);
    const text = body.includes('single generalist') ? SOLO : (TEAM[teamIdx++] ?? `EXTRA-${teamIdx}`);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };

  const { comparison, file } = await runTeamVsSoloComparison({
    request: 'Design, implement, and verify a public API rate limiter.',
    env: ENV, fetchImpl, rootDir, model: MODEL,
  });

  assert.equal(comparison.team.coverage.count, 4, 'the chain covers every role concern');
  assert.equal(comparison.solo.coverage.count, 1, 'the solo generalist covers only implementation');
  assert.equal(comparison.deltas.concernCoverage, 3);
  assert.equal(comparison.verdict, 'team-adds-role-concern-coverage');
  assert.ok(comparison.team.specialists >= 4, 'the base chain ran');

  // The comparison is durably recorded in the comparisons store.
  assert.ok(file.startsWith(comparisonsDir(rootDir)), 'written under the comparisons store');
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(persisted.verdict, 'team-adds-role-concern-coverage');
  assert.equal(persisted.capabilityId, 'orchestration.team');
});
