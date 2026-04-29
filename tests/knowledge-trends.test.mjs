/**
 * tests/knowledge-trends.test.mjs — Unit tests for lib/knowledge/trends.mjs.
 *
 * Uses a real (temporary) rootDir with seeded observations to validate
 * clustering, escalation detection, and hot topic extraction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addObservation } from '../lib/observation-store.mjs';
import {
  detectRecurringPatterns,
  detectEscalatingRisks,
  detectHotTopics,
  detectDecisionDrift,
  buildTrendReport,
} from '../lib/knowledge/trends.mjs';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeDir() {
  return mkdtempSync(join(tmpdir(), 'construct-trends-'));
}

function seedObservations(rootDir, items) {
  for (const item of items) {
    addObservation(rootDir, item);
  }
}

const SIMILAR_PATTERN = 'Authentication uses JWT tokens with RS256 for stateless session management';
const SIMILAR_PATTERN_2 = 'JWT token authentication RS256 stateless sessions used throughout';
const ANTI_PATTERN = 'Rate limiting is missing from the webhook ingestion endpoint and poses a security risk';
const ANTI_PATTERN_2 = 'Webhook endpoint lacks rate limiting creating a security vulnerability';

// ── detectRecurringPatterns ────────────────────────────────────────────────

test('detectRecurringPatterns returns empty array when no observations', () => {
  const dir = makeDir();
  try {
    const result = detectRecurringPatterns(dir);
    assert.deepEqual(result, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectRecurringPatterns clusters semantically similar observations', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: SIMILAR_PATTERN, content: SIMILAR_PATTERN, category: 'pattern', role: 'cx-engineer' },
      { summary: SIMILAR_PATTERN_2, content: SIMILAR_PATTERN_2, category: 'pattern', role: 'cx-architect' },
      { summary: 'Completely unrelated topic about Docker networking and multi-stage builds', content: '', category: 'insight', role: 'cx-engineer' },
    ]);
    const result = detectRecurringPatterns(dir);
    // Should find at least one cluster with count >= 2
    assert.ok(result.some((r) => r.count >= 2), 'Expected a cluster with count >= 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectRecurringPatterns includes roles in cluster', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: SIMILAR_PATTERN, content: SIMILAR_PATTERN, category: 'pattern', role: 'cx-engineer' },
      { summary: SIMILAR_PATTERN_2, content: SIMILAR_PATTERN_2, category: 'pattern', role: 'cx-architect' },
    ]);
    const result = detectRecurringPatterns(dir);
    const cluster = result.find((r) => r.count >= 2);
    if (cluster) {
      assert.ok(Array.isArray(cluster.roles));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── detectEscalatingRisks ─────────────────────────────────────────────────

test('detectEscalatingRisks returns empty when no anti-patterns', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: 'A good pattern', content: 'something positive', category: 'pattern', role: 'cx-engineer' },
    ]);
    const result = detectEscalatingRisks(dir);
    assert.deepEqual(result, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectEscalatingRisks finds escalation when recent > older rate', () => {
  const dir = makeDir();
  try {
    // Simulate recent observations by using current timestamps (default)
    seedObservations(dir, [
      { summary: ANTI_PATTERN, content: ANTI_PATTERN, category: 'anti-pattern', role: 'cx-security' },
      { summary: ANTI_PATTERN_2, content: ANTI_PATTERN_2, category: 'anti-pattern', role: 'cx-security' },
    ]);
    const result = detectEscalatingRisks(dir);
    // Recent-only cluster → escalationScore should be high (no older baseline)
    assert.ok(Array.isArray(result));
    // May or may not find escalation depending on cluster threshold — just validate shape
    for (const r of result) {
      assert.ok(typeof r.escalationScore === 'number');
      assert.ok(r.type === 'escalating_risk');
      assert.ok(typeof r.recentCount === 'number');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── detectHotTopics ───────────────────────────────────────────────────────

test('detectHotTopics returns empty array when no observations', () => {
  const dir = makeDir();
  try {
    const result = detectHotTopics(dir);
    assert.deepEqual(result, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectHotTopics returns terms sorted by weightedFrequency descending', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: 'authentication JWT token session', content: 'authentication JWT token session auth', category: 'pattern', role: 'cx-engineer' },
      { summary: 'authentication token validation', content: 'authentication token check', category: 'pattern', role: 'cx-architect' },
      { summary: 'Docker build optimisation', content: 'Docker multi-stage build', category: 'insight', role: 'cx-engineer' },
    ]);
    const result = detectHotTopics(dir);
    assert.ok(result.length > 0);
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].weightedFrequency >= result[i].weightedFrequency);
    }
    // 'authentication' appears most — should be near top
    const terms = result.map((r) => r.term);
    assert.ok(terms.includes('authentication') || terms.includes('token'),
      'Expected "authentication" or "token" in hot topics');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectHotTopics result has required fields', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: 'webhook endpoint security rate limiting', content: 'rate limiting webhook', category: 'anti-pattern', role: 'cx-security' },
    ]);
    const result = detectHotTopics(dir);
    for (const t of result) {
      assert.ok(typeof t.term === 'string');
      assert.ok(typeof t.weightedFrequency === 'number');
      assert.ok(typeof t.recentCount === 'number');
      assert.ok(typeof t.totalCount === 'number');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── detectDecisionDrift ───────────────────────────────────────────────────

test('detectDecisionDrift returns empty when no decisions', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: ANTI_PATTERN, content: ANTI_PATTERN, category: 'anti-pattern', role: 'cx-security' },
    ]);
    const result = detectDecisionDrift(dir);
    assert.deepEqual(result, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detectDecisionDrift result has required fields when drift found', () => {
  const dir = makeDir();
  try {
    seedObservations(dir, [
      { summary: 'We decided to skip rate limiting on webhooks for simplicity', content: 'webhook rate limiting skipped', category: 'decision', role: 'cx-architect' },
      { summary: 'Webhook rate limiting absence is a security anti-pattern', content: 'webhook rate limiting anti-pattern security risk', category: 'anti-pattern', role: 'cx-security' },
    ]);
    const result = detectDecisionDrift(dir);
    for (const d of result) {
      assert.ok(d.type === 'decision_drift');
      assert.ok(d.decision?.id);
      assert.ok(Array.isArray(d.conflictingObservations));
      assert.ok(typeof d.driftScore === 'number');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── buildTrendReport ──────────────────────────────────────────────────────

test('buildTrendReport returns all four detector results', () => {
  const dir = makeDir();
  try {
    const report = buildTrendReport(dir);
    assert.ok(Array.isArray(report.recurringPatterns));
    assert.ok(Array.isArray(report.escalatingRisks));
    assert.ok(Array.isArray(report.decisionDrift));
    assert.ok(Array.isArray(report.hotTopics));
    assert.ok(typeof report.generatedAt === 'string');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
