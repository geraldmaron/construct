/**
 * lib/certification/specialist-scenarios.mjs — per-specialist certification scenario fixtures (schema v2).
 *
 * v2 fixtures are hand-authored, role-specific, and behavior-oriented: each carries a
 * representativeTask (a real task the specialist would receive, not its own opening
 * question) and an expectedBehavior contract (mustContainAny / mustNotContain /
 * mustRefuse / mustEscalateTo / mustStateAssumptions) a live gate can check against real
 * output. There is no liveScoring field — the catalog `mode` is the single source of
 * truth for whether a scenario runs hermetically or live. The hermetic gate
 * (specialist-scenario-audit) validates fixture structure; the live gate
 * (specialist-behavior-live, construct-72gqn.14) scores real output against expectedBehavior.
 *
 * Adversarial prompts must differ across specialists — a single byte-identical fabrication
 * prompt reused twelve times measured nothing role-specific. validateAdversarialDiversity
 * is the tripwire.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { workerProfileCardsDir } from './worker-profile-cards.mjs';
import { checkWorkerProfileContract } from './worker-profile-contracts.mjs';
import { defaultScenarioCatalogPath } from './scenarios.mjs';

export const SPECIALIST_SCENARIO_SCHEMA_VERSION = 2;

export const SPECIALIST_SCENARIO_KINDS = Object.freeze([
  'happy-path-representative',
  'adversarial-role-tailored',
  'ambiguous',
  'boundary-violation',
  'cross-specialist',
]);

// Each kind fixes the mode (a live gate treats adversarial kinds as refusal probes) and a
// short catalog-id segment, so a fixture's kind, its file name, and its scenario id all
// stay in lockstep.

const KIND_META = Object.freeze({
  'happy-path-representative': { mode: 'normal', idSegment: 'representative' },
  'adversarial-role-tailored': { mode: 'adversarial', idSegment: 'adversarial' },
  'ambiguous': { mode: 'normal', idSegment: 'ambiguous' },
  'boundary-violation': { mode: 'adversarial', idSegment: 'boundary' },
  'cross-specialist': { mode: 'normal', idSegment: 'cross' },
});

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'org'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function specialistScenarioDir(specialistId, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  return path.join(root, 'tests', 'certification', 'scenarios', 'specialists', specialistId);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateExpectedBehavior(expected, errors) {
  if (!expected || typeof expected !== 'object') {
    errors.push('expectedBehavior required');
    return;
  }
  if (!isStringArray(expected.mustContainAny)) errors.push('expectedBehavior.mustContainAny must be a string array');
  if (!isStringArray(expected.mustNotContain)) errors.push('expectedBehavior.mustNotContain must be a string array');
  if (typeof expected.mustRefuse !== 'boolean') errors.push('expectedBehavior.mustRefuse must be a boolean');
  if (!isStringArray(expected.mustEscalateTo)) errors.push('expectedBehavior.mustEscalateTo must be a string array');
  if (typeof expected.mustStateAssumptions !== 'boolean') errors.push('expectedBehavior.mustStateAssumptions must be a boolean');

  const asserts =
    (Array.isArray(expected.mustContainAny) && expected.mustContainAny.length > 0) ||
    expected.mustRefuse === true ||
    (Array.isArray(expected.mustEscalateTo) && expected.mustEscalateTo.length > 0) ||
    expected.mustStateAssumptions === true;
  if (!asserts) {
    errors.push('expectedBehavior asserts nothing — needs at least one of mustContainAny/mustRefuse/mustEscalateTo/mustStateAssumptions');
  }
}

export function validateSpecialistScenarioFixture(fixture, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const errors = [];

  if (fixture?.schemaVersion !== SPECIALIST_SCENARIO_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SPECIALIST_SCENARIO_SCHEMA_VERSION}`);
  }
  if ('liveScoring' in (fixture ?? {})) {
    errors.push('liveScoring field is forbidden — catalog mode is the single source of truth');
  }
  if (!isNonEmptyString(fixture?.specialistId)) errors.push('specialistId required');
  if (!isNonEmptyString(fixture?.capabilityId)) errors.push('capabilityId required');
  if (!SPECIALIST_SCENARIO_KINDS.includes(fixture?.scenarioKind)) {
    errors.push(`scenarioKind must be one of ${SPECIALIST_SCENARIO_KINDS.join(', ')}`);
  }
  const kindMeta = KIND_META[fixture?.scenarioKind];
  if (kindMeta && fixture?.mode !== kindMeta.mode) {
    errors.push(`mode must be ${kindMeta.mode} for scenarioKind ${fixture.scenarioKind}`);
  }

  if (!fixture?.representativeTask || typeof fixture.representativeTask !== 'object') {
    errors.push('representativeTask required');
  } else if (!isNonEmptyString(fixture.representativeTask.prompt)) {
    errors.push('representativeTask.prompt required');
  }

  validateExpectedBehavior(fixture?.expectedBehavior, errors);

  const registry = loadRegistry({ rootDir: root });
  const agent = Object.values(registry.workerProfiles ?? {}).find((entry) => `cx-${entry.name}` === fixture?.specialistId);
  if (!agent) errors.push(`unknown specialist: ${fixture?.specialistId}`);

  const cardPath = path.join(workerProfileCardsDir(root), `${fixture?.workerProfileId}.role-card.json`);
  if (!fs.existsSync(cardPath)) {
    errors.push(`missing role card for ${fixture?.specialistId}`);
  } else {
    const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
    if (card.specialistId !== fixture?.specialistId) errors.push('role card specialistId mismatch');
    if (kindMeta?.mode === 'adversarial') {
      if (!card.refusalBoundaries) errors.push('adversarial scenario requires refusalBoundaries on role card');
      if (fixture?.expectedBehavior?.mustRefuse !== true) errors.push('adversarial scenario must set expectedBehavior.mustRefuse');
    }
  }

  // Escalation targets must name a real specialist the agent can actually hand off to,
  // so a fixture cannot assert an escalation the org can't perform.

  const validTargets = new Set([
    ...(agent?.handoffCandidates ?? []),
    ...Object.values(registry.workerProfiles ?? {}).map((s) => s.name),
  ]);
  for (const target of fixture?.expectedBehavior?.mustEscalateTo ?? []) {
    const bare = target.replace(/^cx-/, '');
    if (!validTargets.has(bare)) errors.push(`mustEscalateTo target not a known specialist/handoff: ${target}`);
  }

  if (agent) {
    const contract = checkWorkerProfileContract(agent, { rootDir: root });
    if (!contract.pass) errors.push(`contract audit failed for ${fixture.specialistId}`);
  }

  return { pass: errors.length === 0, errors };
}

export function readSpecialistScenarioFixtures({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const base = path.join(root, 'tests', 'certification', 'scenarios', 'specialists');
  const fixtures = [];
  if (!fs.existsSync(base)) return fixtures;
  for (const specialistId of fs.readdirSync(base)) {
    const dir = path.join(base, specialistId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(dir, file);
      const fixture = JSON.parse(fs.readFileSync(full, 'utf8'));
      fixtures.push({ specialistId, file, relPath: path.relative(root, full), fixture });
    }
  }
  return fixtures;
}

// The single byte-identical fabrication prompt reused across every specialist was the
// core H2 finding; this fails closed if any two adversarial fixtures share a prompt.

export function validateAdversarialDiversity({ rootDir } = {}) {
  const fixtures = readSpecialistScenarioFixtures({ rootDir });
  const adversarial = fixtures.filter(({ fixture }) => KIND_META[fixture.scenarioKind]?.mode === 'adversarial');
  const seen = new Map();
  const collisions = [];
  for (const { specialistId, fixture } of adversarial) {
    const prompt = (fixture.representativeTask?.prompt ?? '').trim();
    if (seen.has(prompt)) collisions.push(`${specialistId} shares an adversarial prompt with ${seen.get(prompt)}`);
    else seen.set(prompt, specialistId);
  }
  return { pass: collisions.length === 0, collisions, count: adversarial.length };
}

export function syncSpecialistScenarioCatalog({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const fixtures = readSpecialistScenarioFixtures({ rootDir: root });
  const catalogEntries = [];
  for (const { fixture, relPath } of fixtures) {
    const meta = KIND_META[fixture.scenarioKind];
    if (!meta) continue;
    const name = fixture.specialistId.replace(/^cx-/, '');
    // Hermetic entry — validates fixture structure (specialist-scenario-audit).
    catalogEntries.push({
      id: `specialist.${meta.idSegment}.${name}`,
      capabilityId: fixture.capabilityId ?? 'specialist.prompt',
      mode: 'hermetic',
      fixture: { path: relPath },
      gates: [{ id: `specialist-${meta.idSegment}-${name}`, type: 'specialist-scenario-audit' }],
      model: { provider: 'hermetic', requestedId: 'fixture/specialist', resolvedId: 'fixture/specialist', tier: 'hermetic' },
    });
    // Live entry — runs the real persona and scores expectedBehavior. Inconclusive (never
    // pass) without CONSTRUCT_CERTIFY_LIVE=1, on the free tier by default.
    catalogEntries.push({
      id: `specialist.live.${name}.${meta.idSegment}`,
      capabilityId: fixture.capabilityId ?? 'specialist.prompt',
      mode: 'live',
      fixture: { path: relPath },
      gates: [{ id: `specialist-behavior-${name}-${meta.idSegment}`, type: 'specialist-behavior-live' }],
      model: { provider: 'openrouter', requestedId: 'openrouter/free-auto', resolvedId: 'openrouter/free-auto', tier: 'free' },
      requiresEnv: 'CONSTRUCT_CERTIFY_LIVE',
    });
  }
  catalogEntries.sort((a, b) => a.id.localeCompare(b.id));

  const catalogPath = defaultScenarioCatalogPath(root);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const keep = (catalog.scenarios ?? []).filter((s) => {
    const id = String(s.id);
    return !/^specialist\.(representative|adversarial|ambiguous|boundary|cross|normal|live)\./.test(id);
  });
  catalog.scenarios = [...keep, ...catalogEntries];
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return { fixtureCount: fixtures.length, catalogEntries: catalogEntries.length };
}
