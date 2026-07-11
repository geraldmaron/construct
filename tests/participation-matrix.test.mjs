/**
 * tests/participation-matrix.test.mjs — orphan-sweep matrix across
 * specialists, teams, skills, and contracts (construct-pteo2.17 / cdsp.70).
 *
 * Extends tests/participation-coverage.test.mjs (per-entry coverage) with the
 * cross-entity edges: a full matrix over the assembled registry that goes red
 * when any entity is orphaned from the participation model —
 *   - a specialist with no participation path (not a contract-chain endpoint,
 *     no watchConditions, not recruited by any participationRule anywhere,
 *     not manualOnly:true),
 *   - a squad orphaned the same way (groups exempt — they hold decision
 *     rights, not recruitment),
 *   - a contract whose producer/consumer is not a sanctioned party; the
 *     sanctioned set mirrors lib/registry/validator.mjs
 *     checkContractPartiesExist exactly: live specialist ids plus
 *     user/construct/* — the validator maps no retired-role aliases, so
 *     neither does this matrix,
 *   - a participationRule recruiting a specialist/team id that does not exist,
 *   - a watchCondition reference (entry watchConditions or rule
 *     when.watchCondition) naming a watcher undeclared in
 *     specialists/org/watchers.json, and a declared watcher referenced by
 *     nothing,
 *   - a declared skill path with no file under skills/ — asserted through
 *     lib/audit-skills.mjs auditSkills(), the same module behind the doctor
 *     check "No declared skills missing on disk", so the semantic cannot fork.
 *
 * The matrix report (counts per entity type plus orphan lists) is emitted as
 * a single machine-readable JSON line and its shape is asserted — the report
 * is the artifact the acceptance criteria name. KNOWN_ORPHANS pins any real
 * orphan found in the current registry so the sweep is red only on NEW
 * orphans; every pinned entry must name the bead that burns it down. The
 * sweep found none as of construct-pteo2.17, so every allowlist is empty.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadRegistry } from '../lib/registry/loader.mjs';
import { knownWatchers } from '../lib/orchestration/routing-tables.mjs';
import { auditSkills } from '../lib/audit-skills.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pinned real orphans, red only on NEW entries. Each entry must carry the
// bead id that burns it down; an empty list means the sweep is fully clean.

const KNOWN_ORPHANS = {
  specialists: [],
  squads: [],
  contractEndpoints: [],
  ruleTargets: [],
  watcherRefs: [],
  unreferencedWatchers: [],
  missingSkills: [],
};

// Retired roles from the construct-rf26.11 consolidation to the fixed
// 12-role roster. None may dangle as a contract producer/consumer.

const RETIRED_ROLES = [
  'legal-compliance',
  'release-manager',
  'ai-engineer',
  'data-engineer',
  'platform-engineer',
  'rd-lead',
  'ux-researcher',
  'evaluator',
  'trace-reviewer',
];

function declaredRules(entry) {
  const declared = entry?.participationRules;
  if (Array.isArray(declared)) return declared;
  if (declared && Array.isArray(declared.rules)) return declared.rules;
  return [];
}

function watchConditionNames(entry) {
  if (!Array.isArray(entry?.watchConditions)) return [];
  return entry.watchConditions.map((w) => (typeof w === 'string' ? w : w?.watcher)).filter(Boolean);
}

// The full sweep, computed once. Every list is sorted so the emitted report
// and every assertion stay deterministic across runs.

function buildMatrix() {
  const registry = loadRegistry({ rootDir: REPO });
  const specialists = registry.specialists ?? {};
  const teams = registry.teams ?? {};
  const contracts = registry.contracts ?? {};
  const specialistIds = new Set(Object.keys(specialists));
  const teamIds = new Set(Object.keys(teams));
  const squads = Object.entries(teams).filter(([, t]) => t.kind === 'squad');
  const groups = Object.entries(teams).filter(([, t]) => t.kind === 'group');
  const declaredWatchers = new Set(knownWatchers());

  const allEntries = [
    ...Object.entries(specialists).map(([id, entry]) => ({ id, entry, kind: 'specialist' })),
    ...Object.entries(teams).map(([id, entry]) => ({ id, entry, kind: entry.kind ?? 'team' })),
  ];

  // Recruitment edges: every rule anywhere contributes its recruit targets,
  // and a recruited team pulls its member specialists (the recruiter expands
  // squads hierarchy-aware, so team membership is a participation path).

  const recruitedSpecialists = new Set();
  const recruitedTeams = new Set();
  const danglingRuleTargets = [];
  const watcherRefProblems = [];
  const referencedWatchers = new Set();
  let ruleCount = 0;

  for (const { id, entry } of allEntries) {
    for (const name of watchConditionNames(entry)) {
      referencedWatchers.add(name);
      if (!declaredWatchers.has(name)) {
        watcherRefProblems.push({ source: id, via: 'watchConditions', watcher: name });
      }
    }
    for (const rule of declaredRules(entry)) {
      ruleCount += 1;
      if (typeof rule?.when?.watchCondition === 'string') {
        referencedWatchers.add(rule.when.watchCondition);
        if (!declaredWatchers.has(rule.when.watchCondition)) {
          watcherRefProblems.push({ source: id, via: `rule:${rule.id}`, watcher: rule.when.watchCondition });
        }
      }
      for (const target of rule.recruit?.specialists ?? []) {
        if (specialistIds.has(target)) recruitedSpecialists.add(target);
        else danglingRuleTargets.push({ rule: rule.id, source: id, target, targetKind: 'specialist' });
      }
      for (const target of rule.recruit?.teams ?? []) {
        if (!teamIds.has(target)) {
          danglingRuleTargets.push({ rule: rule.id, source: id, target, targetKind: 'team' });
          continue;
        }
        recruitedTeams.add(target);
        for (const [sid, s] of Object.entries(specialists)) {
          if (s?.team === target) recruitedSpecialists.add(sid);
        }
      }
    }
  }

  // Contract edges: the sanctioned-party set is exactly the validator's
  // (checkContractPartiesExist) — live specialist ids plus user/construct/*.
  // Explicitly named specialist endpoints are chain-selectable; the wildcard
  // producer '*' names nobody, so it confers chain membership on no one.

  const sanctionedParties = new Set(['user', 'construct', '*', ...specialistIds]);
  const contractEndpointSpecialists = new Set();
  const danglingContractEndpoints = [];

  for (const [contractId, contract] of Object.entries(contracts)) {
    for (const side of ['producer', 'consumer']) {
      const party = contract[side];
      if (!sanctionedParties.has(party)) {
        danglingContractEndpoints.push({ contract: contractId, side, party });
      } else if (specialistIds.has(party)) {
        contractEndpointSpecialists.add(party);
      }
    }
  }

  // Participation paths per entity. A specialist is orphaned only when every
  // path fails; a squad has no contract-chain membership of its own, so its
  // paths are manualOnly, own conditions/rules, or being a recruit target.

  const hasOwnCondition = (entry) =>
    watchConditionNames(entry).length > 0 || declaredRules(entry).length > 0;

  const orphanSpecialists = Object.entries(specialists)
    .filter(([id, entry]) =>
      entry?.manualOnly !== true
      && !hasOwnCondition(entry)
      && !recruitedSpecialists.has(id)
      && !contractEndpointSpecialists.has(id))
    .map(([id]) => id);

  const orphanSquads = squads
    .filter(([id, entry]) =>
      entry?.manualOnly !== true
      && !hasOwnCondition(entry)
      && !recruitedTeams.has(id))
    .map(([id]) => id);

  const unreferencedWatchers = [...declaredWatchers].filter((w) => !referencedWatchers.has(w));

  const skillAudit = auditSkills({ rootDir: REPO, silent: true });
  const declaredSkillCount = Object.values(specialists)
    .reduce((n, s) => n + (Array.isArray(s.skills) ? s.skills.length : 0), 0);
  const missingSkills = skillAudit.missingSkillFiles.map(({ agent, skill }) => `cx-${agent} -> ${skill}`);

  const sortByJson = (arr) => [...arr].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  return {
    counts: {
      specialists: specialistIds.size,
      squads: squads.length,
      groups: groups.length,
      contracts: Object.keys(contracts).length,
      participationRules: ruleCount,
      declaredWatchers: declaredWatchers.size,
      declaredSkills: declaredSkillCount,
    },
    orphans: {
      specialists: orphanSpecialists.sort(),
      squads: orphanSquads.sort(),
      contractEndpoints: sortByJson(danglingContractEndpoints),
      ruleTargets: sortByJson(danglingRuleTargets),
      watcherRefs: sortByJson(watcherRefProblems),
      unreferencedWatchers: unreferencedWatchers.sort(),
      missingSkills: missingSkills.sort(),
    },
  };
}

const matrix = buildMatrix();

function newOrphans(key) {
  const pinned = new Set(KNOWN_ORPHANS[key].map((e) => JSON.stringify(e)));
  return matrix.orphans[key].filter((e) => !pinned.has(JSON.stringify(e)));
}

test('no specialist is orphaned from the participation model', () => {
  const fresh = newOrphans('specialists');
  assert.deepEqual(fresh, [], `specialists with no participation path (no chain edge, no watchConditions, not recruited, not manualOnly): ${fresh.join(', ')}`);
});

test('no squad is orphaned from the participation model (groups exempt)', () => {
  const fresh = newOrphans('squads');
  assert.deepEqual(fresh, [], `squads with no participation path: ${fresh.join(', ')}`);
  assert.ok(matrix.counts.groups > 0, 'groups exist and are exempted, not silently dropped');
});

test('every contract producer/consumer is a live roster id or sanctioned party', () => {
  const fresh = newOrphans('contractEndpoints');
  assert.deepEqual(fresh, [], `dangling contract endpoints: ${JSON.stringify(fresh)}`);
});

test('no contract endpoint names a retired role from the rf26.11 consolidation', () => {
  const registry = loadRegistry({ rootDir: REPO });
  const retired = new Set(RETIRED_ROLES.flatMap((r) => [r, `cx-${r}`]));
  const hits = [];
  for (const [contractId, contract] of Object.entries(registry.contracts ?? {})) {
    for (const side of ['producer', 'consumer']) {
      if (retired.has(contract[side])) hits.push({ contract: contractId, side, party: contract[side] });
    }
  }
  assert.deepEqual(hits, [], `retired roles dangling as contract parties: ${JSON.stringify(hits)}`);
});

test('every participationRule recruit target exists in the registry', () => {
  const fresh = newOrphans('ruleTargets');
  assert.deepEqual(fresh, [], `rules recruiting nonexistent ids: ${JSON.stringify(fresh)}`);
});

test('every watchCondition reference names a declared watcher, and every declared watcher is referenced', () => {
  const freshRefs = newOrphans('watcherRefs');
  assert.deepEqual(freshRefs, [], `undeclared watcher references: ${JSON.stringify(freshRefs)}`);
  const freshUnreferenced = newOrphans('unreferencedWatchers');
  assert.deepEqual(freshUnreferenced, [], `declared watchers referenced by no entry or rule: ${freshUnreferenced.join(', ')}`);
});

test('every declared skill path resolves on disk (doctor semantic, via auditSkills)', () => {
  const fresh = newOrphans('missingSkills');
  assert.deepEqual(fresh, [], `declared skills missing on disk: ${fresh.join(', ')}`);
  assert.ok(matrix.counts.declaredSkills > 0, 'skill declarations were actually swept');
});

test('the matrix report is emitted and machine-readable with the expected shape', () => {
  const line = `participation-matrix-report ${JSON.stringify(matrix)}`;
  console.log(line);

  const parsed = JSON.parse(line.replace('participation-matrix-report ', ''));
  assert.deepEqual(
    Object.keys(parsed.counts).sort(),
    ['contracts', 'declaredSkills', 'declaredWatchers', 'groups', 'participationRules', 'specialists', 'squads'],
  );
  assert.deepEqual(
    Object.keys(parsed.orphans).sort(),
    ['contractEndpoints', 'missingSkills', 'ruleTargets', 'specialists', 'squads', 'unreferencedWatchers', 'watcherRefs'],
  );
  for (const list of Object.values(parsed.orphans)) {
    assert.ok(Array.isArray(list), 'every orphan bucket is a list');
  }
  assert.equal(parsed.counts.specialists, 12, 'roster is fixed at 12');
  assert.ok(parsed.counts.contracts >= 30, 'the contract catalog was swept');
  assert.ok(parsed.counts.declaredWatchers >= 7, 'watchers.json was swept');
});
