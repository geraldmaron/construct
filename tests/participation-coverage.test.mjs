/**
 * tests/participation-coverage.test.mjs — every Worker Profile is recruitable
 * or explicitly manual-only.
 *
 * Fails when any of the 12 Worker Profiles lacks a declared
 * participation condition (watchConditions or participationRules) or an
 * explicit manualOnly:true — the gap this bead closes was 7 of 12 specialists
 * carrying watchConditions:[] and being unreachable by condition-driven
 * recruitment. Also pins that the watch-condition predicates are
 * registry-declared (registry/watchers.json drives knownWatchers, the
 * hardcoded WATCHERS map is gone) with unchanged semantics, and that a
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../lib/registry/loader.mjs';
import { knownWatchers, watcherFires, evaluateWatchConditions } from '../lib/orchestration/routing-tables.mjs';
import { recruit } from '../lib/orchestration/recruiter.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER_SIZE = 12;

function declaredRules(entry) {
  const declared = entry?.participationRules;
  if (Array.isArray(declared)) return declared;
  if (declared && Array.isArray(declared.rules)) return declared.rules;
  return [];
}

function isCovered(entry) {
  if (entry?.manualOnly === true) return true;
  if (Array.isArray(entry?.watchConditions) && entry.watchConditions.length > 0) return true;
  return declaredRules(entry).length > 0;
}

test('all 12 Worker Profiles declare a participation condition or explicit manualOnly', () => {
  const registry = loadRegistry();
  const ids = Object.keys(registry.workerProfiles);
  assert.equal(ids.length, ROSTER_SIZE, `roster is fixed at ${ROSTER_SIZE}`);
  const uncovered = ids.filter((id) => !isCovered(registry.workerProfiles[id]));
  assert.deepEqual(uncovered, [], `unreachable Worker Profiles: ${uncovered.join(', ')}`);
});

test('watchers are registry-declared: watchers.json drives the known set', () => {
  const file = JSON.parse(fs.readFileSync(path.join(REPO, 'registry', 'watchers.json'), 'utf8'));
  const declared = file.watchers.map((w) => w.name).sort();
  assert.deepEqual(knownWatchers().slice().sort(), declared, 'knownWatchers comes from watchers.json');
  assert.ok(declared.length >= 7, 'the six ported predicates plus architecture-risk');

  const source = fs.readFileSync(path.join(REPO, 'lib', 'orchestration', 'routing-tables.mjs'), 'utf8');
  assert.equal(source.includes('const WATCHERS = {'), false, 'the hardcoded WATCHERS map is gone');
});

test('ported watcher semantics are unchanged and unknown operators fail closed', () => {
  assert.equal(watcherFires('high-ambiguity-deep-work', { ambiguityScore: 0.6, workCategory: 'deep' }), true);
  assert.equal(watcherFires('high-ambiguity-deep-work', { ambiguityScore: 0.5, workCategory: 'deep' }), false);
  assert.equal(watcherFires('visual-or-ui-risk', { visualDeliverable: true }), true);
  assert.equal(watcherFires('visual-or-ui-risk', { riskFlags: { ui: true } }), true);
  assert.equal(watcherFires('visual-or-ui-risk', {}), false);
  assert.equal(watcherFires('auth-payments-non-narrow', { authOrPayments: true, blastRadius: 'wide' }), true);
  assert.equal(watcherFires('auth-payments-non-narrow', { authOrPayments: true, blastRadius: 'narrow' }), false);
  assert.equal(watcherFires('auth-payments-non-narrow', { authOrPayments: true }), true, 'undefined blastRadius is non-narrow, matching the ported predicate');
  assert.equal(watcherFires('architecture-without-metric', { riskFlags: { architecture: true }, hasSuccessMetric: false }), true);
  assert.equal(watcherFires('architecture-without-metric', { riskFlags: { architecture: true }, hasSuccessMetric: true }), false);
  assert.equal(watcherFires('wide-blast-radius', { blastRadius: 'wide' }), true);
  assert.equal(watcherFires('named-cost-constraint', { hasNamedConstraints: true, cost: true }), true);
  assert.equal(watcherFires('architecture-risk', { riskFlags: { architecture: true } }), true);
  assert.equal(watcherFires('architecture-risk', { riskFlags: {} }), false);
});

test('the new architecture-risk watcher is bound to architect', () => {
  const triggers = evaluateWatchConditions({ riskFlags: { architecture: true }, hasSuccessMetric: true });
  const arch = triggers.find((t) => t.watcher === 'architecture-risk');
  assert.ok(arch, 'architecture-risk fires');
  assert.equal(arch.workerProfile, 'architect');
});

test('every declared participation rule is structurally sound', () => {
  const registry = loadRegistry();
  const entries = Object.values(registry.workerProfiles);
  const seenIds = new Set();
  for (const entry of entries) {
    for (const rule of declaredRules(entry)) {
      assert.match(rule.id, /^[a-z][a-z0-9-]{1,60}$/, `rule id shape: ${rule.id}`);
      assert.equal(seenIds.has(rule.id), false, `duplicate rule id across registry: ${rule.id}`);
      seenIds.add(rule.id);
      assert.ok(rule.when?.watchCondition || rule.when?.signalExpr, `rule ${rule.id} has an evaluable when`);
      if (rule.when?.watchCondition) {
        assert.ok(knownWatchers().includes(rule.when.watchCondition), `rule ${rule.id} references a declared watcher`);
      }
      assert.ok((rule.workerProfiles?.length ?? 0) > 0, `rule ${rule.id} assigns a Worker Profile`);
      assert.ok(['author', 'reviewer', 'advisor'].includes(rule.assignmentRole), `rule ${rule.id} assignment role enum`);
      assert.ok(['advisory', 'enforced'].includes(rule.gate), `rule ${rule.id} gate enum`);
      if (rule.gate === 'enforced') {
        assert.ok(rule.workerProfiles.length > 0, `enforced rule ${rule.id} names its governed Worker Profiles`);
      }
    }
  }
  assert.ok(seenIds.size >= 6, 'the coverage rules landed');
});

test('registry-declared rules recruit through the live recruiter', () => {
  const costRecruits = recruit({ signals: { cost: true } });
  const analyst = costRecruits.find((p) => p.workerProfile === 'data-analyst');
  assert.ok(analyst, 'cost recruits data-analyst');

  const reliability = recruit({ signals: { reliability: true } });
  const roles = new Set(reliability.map((p) => p.workerProfile));
  assert.ok(roles.has('debugger'), 'reliability rule recruits debugger as advisor');
  const debuggerEntry = reliability.find((p) => p.workerProfile === 'debugger');
  assert.equal(debuggerEntry.assignmentRole, 'advisor');
});
