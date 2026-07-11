/**
 * tests/participation-coverage.test.mjs — every specialist and team is
 * recruitable, or says explicitly that it is not (construct-pteo2.6).
 *
 * Fails when any of the 12 roster specialists or 8 teams lacks a declared
 * participation condition (watchConditions or participationRules) or an
 * explicit manualOnly:true — the gap this bead closes was 7 of 12 specialists
 * carrying watchConditions:[] and being unreachable by condition-driven
 * recruitment. Also pins that the watch-condition predicates are
 * registry-declared (specialists/org/watchers.json drives knownWatchers, the
 * hardcoded WATCHERS map is gone) with unchanged semantics, and that a
 * team-recruiting rule pulls its squad members (hierarchy-aware).
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
const TEAM_COUNT = 8;

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

test('all 12 specialists declare a participation condition or explicit manualOnly', () => {
  const registry = loadRegistry();
  const ids = Object.keys(registry.specialists);
  assert.equal(ids.length, ROSTER_SIZE, `roster is fixed at ${ROSTER_SIZE}`);
  const uncovered = ids.filter((id) => !isCovered(registry.specialists[id]));
  assert.deepEqual(uncovered, [], `unreachable specialists (no condition, no manualOnly): ${uncovered.join(', ')}`);
});

test('all 8 squads declare a participation condition or explicit manualOnly', () => {
  const registry = loadRegistry();
  const squads = Object.entries(registry.teams ?? {}).filter(([, t]) => t.kind === 'squad');
  assert.equal(squads.length, TEAM_COUNT, `squad set is ${TEAM_COUNT} (groups hold decision rights, not recruitment)`);
  const uncovered = squads.filter(([, t]) => !isCovered(t)).map(([id]) => id);
  assert.deepEqual(uncovered, [], `unreachable teams: ${uncovered.join(', ')}`);
});

test('watchers are registry-declared: watchers.json drives the known set', () => {
  const file = JSON.parse(fs.readFileSync(path.join(REPO, 'specialists', 'org', 'watchers.json'), 'utf8'));
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

test('the new architecture-risk watcher is bound to cx-architect', () => {
  const triggers = evaluateWatchConditions({ riskFlags: { architecture: true }, hasSuccessMetric: true });
  const arch = triggers.find((t) => t.watcher === 'architecture-risk');
  assert.ok(arch, 'architecture-risk fires');
  assert.equal(arch.specialist, 'cx-architect');
});

test('every declared participation rule is structurally sound', () => {
  const registry = loadRegistry();
  const entries = [...Object.values(registry.specialists), ...Object.values(registry.teams ?? {})];
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
      assert.ok((rule.recruit?.specialists?.length ?? 0) + (rule.recruit?.teams?.length ?? 0) > 0, `rule ${rule.id} recruits someone`);
      assert.ok(['author', 'reviewer', 'advisor'].includes(rule.role), `rule ${rule.id} role enum`);
      assert.ok(['advisory', 'enforced'].includes(rule.gate), `rule ${rule.id} gate enum`);
      if (rule.gate === 'enforced') {
        assert.ok(rule.enforcementScope?.team && rule.enforcementScope?.decisionRight, `enforced rule ${rule.id} names its enforcementScope`);
      }
      if (rule.dimension === 'legal-compliance') {
        assert.ok(rule.recruit?.specialists?.includes('cx-security'), `legal-compliance rule ${rule.id} recruits cx-security (no 13th role)`);
      }
    }
  }
  assert.ok(seenIds.size >= 6, 'the coverage rules landed');
});

test('registry-declared rules recruit through the live recruiter', () => {
  const costRecruits = recruit({ signals: { cost: true } });
  const analyst = costRecruits.find((p) => p.specialist === 'cx-data-analyst');
  assert.ok(analyst, 'cost recruits cx-data-analyst');

  const reliability = recruit({ signals: { reliability: true } });
  const roles = new Set(reliability.map((p) => p.specialist));
  assert.ok(roles.has('cx-debugger'), 'reliability rule recruits cx-debugger as advisor');
  const debuggerEntry = reliability.find((p) => p.specialist === 'cx-debugger');
  assert.equal(debuggerEntry.role, 'advisor');
});

test('a team-recruiting rule pulls its squad members (hierarchy-aware)', () => {
  const participants = recruit({ signals: { compliance: true } });
  const governance = participants.find((p) => p.team === 'governance-team' && !p.specialist);
  assert.ok(governance, 'compliance recruits the governance team');
  assert.ok(Array.isArray(governance.members), 'team entry lists squad members');
  assert.ok(governance.members.includes('cx-security'), `squad expansion includes cx-security; got ${governance.members.join(', ')}`);
  const security = participants.find((p) => p.specialist === 'cx-security');
  assert.ok(security, 'the legal-compliance binding also recruits cx-security directly');
});
