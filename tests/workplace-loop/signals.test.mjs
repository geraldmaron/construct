/**
 * tests/workplace-loop/signals.test.mjs — unit coverage for
 * lib/workplace-loop/signals.mjs.
 *
 * Fixtures here deliberately mirror messy real-GitHub-issue shapes (missing
 * bodies, inconsistent label casing, no assignee) rather than a clean
 * hand-tuned set — the requirement this bead exists to satisfy is detection
 * quality against real, non-curated data, so these detectors are exercised
 * against the kind of incompleteness real issues actually have.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectStaleIssues, detectUnownedRiskIssues, classifyNoiseIssues, detectSignals } from '../../lib/workplace-loop/signals.mjs';

const ASOF = '2026-07-17T00:00:00Z';

function issue(overrides = {}) {
  return {
    id: 'GH-1',
    title: 'untitled',
    body: '',
    state: 'open',
    labels: [],
    assignee: null,
    updatedAt: ASOF,
    createdAt: ASOF,
    url: 'https://github.com/o/r/issues/1',
    source: { kind: 'github', repo: 'o/r', ref: '#1' },
    ...overrides,
  };
}

test('detectStaleIssues flags an open issue with no activity past the threshold', () => {
  const issues = [issue({ updatedAt: '2026-05-01T00:00:00Z' })];
  const signals = detectStaleIssues(issues, { asOf: ASOF, staleDays: 30 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'stale_issue');
  assert.equal(signals[0].sources[0].repo, 'o/r');
});

test('detectStaleIssues does not flag a recently-updated issue', () => {
  const issues = [issue({ updatedAt: '2026-07-10T00:00:00Z' })];
  assert.deepEqual(detectStaleIssues(issues, { asOf: ASOF, staleDays: 30 }), []);
});

test('detectStaleIssues ignores closed issues even if stale', () => {
  const issues = [issue({ state: 'closed', updatedAt: '2026-01-01T00:00:00Z' })];
  assert.deepEqual(detectStaleIssues(issues, { asOf: ASOF, staleDays: 30 }), []);
});

test('detectStaleIssues escalates severity for issues stale beyond 2x the threshold', () => {
  const barelyStale = detectStaleIssues([issue({ id: 'GH-2', updatedAt: '2026-06-10T00:00:00Z' })], { asOf: ASOF, staleDays: 30 });
  const veryStale = detectStaleIssues([issue({ id: 'GH-3', updatedAt: '2026-01-01T00:00:00Z' })], { asOf: ASOF, staleDays: 30 });
  assert.equal(barelyStale[0].severity, 'medium');
  assert.equal(veryStale[0].severity, 'high');
});

test('detectUnownedRiskIssues flags an unowned issue with a risk-suggestive label', () => {
  const issues = [issue({ labels: ['enterprise-blocker', 'needs-triage'] })];
  const signals = detectUnownedRiskIssues(issues);
  assert.equal(signals.length, 1);
  assert.match(signals[0].summary, /enterprise-blocker/);
});

test('detectUnownedRiskIssues does not flag a risk-labeled issue that has an assignee', () => {
  const issues = [issue({ labels: ['critical'], assignee: 'someone' })];
  assert.deepEqual(detectUnownedRiskIssues(issues), []);
});

test('detectUnownedRiskIssues does not flag an unowned issue with no risk label', () => {
  const issues = [issue({ labels: ['good-first-issue'] })];
  assert.deepEqual(detectUnownedRiskIssues(issues), []);
});

test('classifyNoiseIssues flags a labeled-noise issue', () => {
  const issues = [issue({ labels: ['question'] })];
  const noise = classifyNoiseIssues(issues);
  assert.equal(noise.length, 1);
  assert.match(noise[0].reason, /noise label/);
});

test('classifyNoiseIssues flags an unlabeled, unowned issue with a short body', () => {
  const issues = [issue({ body: 'quick q' })];
  assert.equal(classifyNoiseIssues(issues).length, 1);
});

test('classifyNoiseIssues does not flag an unlabeled issue with a substantive body', () => {
  const issues = [issue({ body: 'x'.repeat(120) })];
  assert.deepEqual(classifyNoiseIssues(issues), []);
});

test('detectSignals excludes noise-classified issues from the meaningful set even if otherwise stale', () => {
  const issues = [issue({ id: 'GH-9', labels: ['wontfix'], updatedAt: '2026-01-01T00:00:00Z' })];
  const { meaningful, noise } = detectSignals(issues, { asOf: ASOF, staleDays: 30 });
  assert.equal(noise.length, 1);
  assert.equal(meaningful.length, 0, 'a wontfix-labeled issue must not also surface as a stale-issue signal');
});

test('detectSignals over an empty issue set reports zero signals and zero noise — no fabrication', () => {
  const { meaningful, noise } = detectSignals([], { asOf: ASOF });
  assert.deepEqual(meaningful, []);
  assert.deepEqual(noise, []);
});
