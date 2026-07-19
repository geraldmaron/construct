/**
 * tests/registry/org-api.test.mjs — ADR-0072 no-code org authoring API CRUD gate.
 *
 * Every test runs against an isolated tmpdir project seeded with a copy of
 * the repo's real specialists/org/** fixture (12 specialists, 36 contracts,
 * 8 teams + 6 groups, re-verified on staging 2026-07-10) — never against
 * the real repo's specialists/org/ or project overlay org dir (customOrgDir). CONSTRUCT_HOME_OVERRIDE
 * (lib/paths.mjs#homeDir) redirects the 'user' tier to a tmpdir, same reason.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  removeEntity,
  exportOrg,
  importOrg,
  previewRoute,
  previewEffectiveFence,
  validateDraft,
  listParticipationRules,
  validateParticipationRule,
  upsertParticipationRule,
  removeParticipationRule,
  previewParticipation,
  participationEditorMeta,
} from '../../lib/registry/org-api.mjs';
import { customOrgDir } from '../../lib/registry/custom-scaffold.mjs';

const REPO_ROOT = process.cwd();

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'org-api-home-'));
const originalHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  if (originalHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = originalHomeOverride;
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

function makeFixtureProject(prefix = 'org-api-') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(path.join(REPO_ROOT, 'specialists', 'org'), path.join(tmp, 'specialists', 'org'), { recursive: true });
  return tmp;
}

// Shared read-only fixture for tests that never write — cheaper than a fresh
// copy per test, safe only because nothing here mutates it.

const readOnlyProject = makeFixtureProject('org-api-readonly-');
after(() => fs.rmSync(readOnlyProject, { recursive: true, force: true }));

test('listEntities: specialist/team/contract against real fixture counts', () => {
  const specialists = listEntities('specialist', { rootDir: readOnlyProject });
  assert.equal(specialists.count, 12);
  assert.ok(specialists.items.every((row) => row.scope === 'builtin'));

  const teams = listEntities('team', { rootDir: readOnlyProject });
  assert.equal(teams.count, 14); // 8 teams + 6 groups, merged like assembleRegistry does

  const contracts = listEntities('contract', { rootDir: readOnlyProject });
  assert.equal(contracts.count, 36);
});

test('listEntities/getEntity: fence resolves to the owning specialist sub-object', () => {
  const fences = listEntities('fence', { rootDir: readOnlyProject });
  assert.equal(fences.count, 12);

  const fence = getEntity('fence', 'architect', { rootDir: readOnlyProject });
  assert.ok(fence);
  assert.ok(Array.isArray(fence.record.allowedPaths));
  assert.ok(fence.record.allowedPaths.includes('docs/decisions/adr/**'));
});

test('listEntities/getEntity: skill walks skills/** read-only', () => {
  const skills = listEntities('skill', { rootDir: REPO_ROOT });
  assert.ok(skills.count > 0);
  const one = getEntity('skill', skills.items[0].id, { rootDir: REPO_ROOT });
  assert.ok(one);
  assert.equal(one.path, skills.items[0].path);
});

test('getEntity: specialist and team resolve by id through the builtin tier', () => {
  const architect = getEntity('specialist', 'architect', { rootDir: readOnlyProject });
  assert.ok(architect);
  assert.equal(architect.scope, 'builtin');
  assert.equal(architect.record.role, 'architect');

  const team = getEntity('team', 'engineering-team', { rootDir: readOnlyProject });
  assert.ok(team);
  assert.equal(team.record.owner, 'architect');

  assert.equal(getEntity('specialist', 'cx-does-not-exist', { rootDir: readOnlyProject }), null);
});

test('createEntity: writes a valid new specialist to project scope', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const result = createEntity('specialist', {
    id: 'widget-tester',
    role: 'widget-tester',
    description: 'Verifies widget behavior against the acceptance criteria before handoff.',
    modelTier: 'standard',
    team: 'engineering-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
    claudeTools: 'Read,Grep,Glob,LS',
  }, { rootDir: tmp, scope: 'project' });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(fs.existsSync(result.path));
  assert.equal(result.record.role, 'widget-tester');

  const fetched = getEntity('specialist', 'cx-widget-tester', { rootDir: tmp });
  assert.ok(fetched);
  assert.equal(fetched.scope, 'project');
});

test('createEntity: rejects an invalid specialist with FieldError[]', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const result = createEntity('specialist', {
    id: 'broken-widget',
    // missing role and description on purpose
    modelTier: 'standard',
    team: 'engineering-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  }, { rootDir: tmp, scope: 'project' });

  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
  for (const err of result.errors) {
    assert.ok(err.id);
    assert.ok(err.severity);
    assert.ok(err.message);
    assert.ok(err.location);
  }
  assert.ok(result.errors.some((e) => e.field === 'description'));
  assert.equal(fs.existsSync(path.join(customOrgDir('project', { rootDir: tmp }), 'specialists', 'cx-broken-widget.json')), false);
});

test('createEntity: scope "builtin" is refused, never written', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const before = fs.readdirSync(path.join(tmp, 'specialists', 'org', 'specialists')).length;

  const result = createEntity('specialist', {
    id: 'sneaky-widget',
    role: 'sneaky-widget',
    description: 'Attempts to land directly in the builtin tier, which must be refused.',
    modelTier: 'standard',
    team: 'engineering-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  }, { rootDir: tmp, scope: 'builtin' });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].id, 'builtin-scope-readonly');
  assert.equal(fs.existsSync(path.join(tmp, 'specialists', 'org', 'specialists', 'cx-sneaky-widget.json')), false);
  assert.equal(fs.readdirSync(path.join(tmp, 'specialists', 'org', 'specialists')).length, before);

  // Same refusal for team, contract, and importOrg — the hard constraint applies to every write function.
  const teamResult = createEntity('team', { id: 'sneaky-team', name: 'Sneaky', owner: 'x', roles: ['x'], charter: 'A team that should never be written to builtin scope.' }, { rootDir: tmp, scope: 'builtin' });
  assert.equal(teamResult.ok, false);
  assert.equal(teamResult.errors[0].id, 'builtin-scope-readonly');

  const importResult = importOrg({ specialists: {} }, { rootDir: tmp, scope: 'builtin' });
  assert.equal(importResult.ok, false);
  assert.equal(importResult.errors[0].id, 'builtin-scope-readonly');
});

test('updateEntity: patches an existing project-tier entity', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const created = createEntity('specialist', {
    id: 'patchable-widget',
    role: 'patchable-widget',
    description: 'Original description long enough to pass shape validation.',
    modelTier: 'standard',
    team: 'engineering-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  }, { rootDir: tmp, scope: 'project' });
  assert.equal(created.ok, true, JSON.stringify(created.errors));

  const patched = updateEntity('specialist', 'cx-patchable-widget', {
    description: 'Updated description, still long enough to pass shape validation.',
  }, { rootDir: tmp, scope: 'project' });

  assert.equal(patched.ok, true, JSON.stringify(patched.errors));
  assert.equal(patched.record.description, 'Updated description, still long enough to pass shape validation.');

  const reread = JSON.parse(fs.readFileSync(patched.path, 'utf8'));
  assert.equal(reread.description, 'Updated description, still long enough to pass shape validation.');
});

test('removeEntity: refuses when another entity still references the target, unless force', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const team = createEntity('team', {
    id: 'qa-temp-team',
    name: 'QA Temp Team',
    owner: 'temp-owner-role',
    roles: ['temp-owner-role'],
    charter: 'A temporary team used only for org-api removeEntity reference-integrity testing.',
  }, { rootDir: tmp, scope: 'project' });
  assert.equal(team.ok, true, JSON.stringify(team.errors));

  const specialist = createEntity('specialist', {
    id: 'temp-owner',
    role: 'temp-owner-role',
    description: 'Owns the temporary QA team used only for this removeEntity test.',
    modelTier: 'standard',
    team: 'qa-temp-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  }, { rootDir: tmp, scope: 'project' });
  assert.equal(specialist.ok, true, JSON.stringify(specialist.errors));

  const blocked = removeEntity('team', 'qa-temp-team', { rootDir: tmp, scope: 'project' });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((e) => e.id === 'team-still-referenced'));
  assert.ok(fs.existsSync(path.join(customOrgDir('project', { rootDir: tmp }), 'teams', 'qa-temp-team.json')));

  const forced = removeEntity('team', 'qa-temp-team', { rootDir: tmp, scope: 'project', force: true });
  assert.equal(forced.ok, true, JSON.stringify(forced.errors));
  assert.equal(fs.existsSync(path.join(customOrgDir('project', { rootDir: tmp }), 'teams', 'qa-temp-team.json')), false);
});

test('exportOrg/importOrg: round-trips the project tier', () => {
  const source = makeFixtureProject('org-api-export-src-');
  const dest = makeFixtureProject('org-api-export-dst-');
  after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  const created = createEntity('specialist', {
    id: 'roundtrip-widget',
    role: 'roundtrip-widget',
    description: 'Exists to be exported from one project tier and imported into another.',
    modelTier: 'standard',
    team: 'engineering-team',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  }, { rootDir: source, scope: 'project' });
  assert.equal(created.ok, true, JSON.stringify(created.errors));

  const exported = exportOrg({ rootDir: source, scope: 'project' });
  assert.equal(exported.scope, 'project');
  assert.ok(exported.specialists['cx-roundtrip-widget']);

  const imported = importOrg(exported, { rootDir: dest, scope: 'project' });
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));
  assert.ok(imported.written.some((p) => p.endsWith('cx-roundtrip-widget.json')));

  const fetched = getEntity('specialist', 'cx-roundtrip-widget', { rootDir: dest });
  assert.ok(fetched);
  assert.equal(fetched.scope, 'project');
  assert.equal(fetched.record.role, 'roundtrip-widget');
});

test('importOrg: dryRun validates without writing', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const payload = {
    specialists: {
      'cx-dry-run-widget': {
        name: 'dry-run-widget',
        role: 'dry-run-widget',
        description: 'A dry-run import that must validate but never write a file.',
        modelTier: 'standard',
        team: 'engineering-team',
        skills: ['architecture/api-design'],
        fence: { allowedPaths: ['docs/**'] },
      },
    },
  };

  const result = importOrg(payload, { rootDir: tmp, scope: 'project', dryRun: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.written, []);
  assert.equal(fs.existsSync(path.join(customOrgDir('project', { rootDir: tmp }), 'specialists', 'cx-dry-run-widget.json')), false);
});

test('validateDraft: unions a custom-schema shape error and a validator.mjs graph error', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const draft = {
    name: 'dual-error-widget',
    // "role" omitted on purpose -> custom-schema.mjs shape error
    description: 'A draft specialist deliberately missing role and pointing at a fake team.',
    modelTier: 'standard',
    team: 'team-that-does-not-exist',
    skills: ['architecture/api-design'],
    fence: { allowedPaths: ['docs/**'] },
  };

  const result = validateDraft('specialist', draft, { rootDir: tmp });

  assert.equal(result.ok, false);
  const shapeError = result.errors.find((e) => e.id.startsWith('custom-specialist-') && e.field === 'role');
  assert.ok(shapeError, `expected a custom-schema role shape error, got: ${JSON.stringify(result.errors)}`);

  const graphError = result.errors.find((e) => e.id === 'specialist-unknown-team');
  assert.ok(graphError, `expected a validator.mjs graph error, got: ${JSON.stringify(result.errors)}`);
  assert.equal(graphError.location, `#/specialists/cx-dual-error-widget/team`);
});

test('previewEffectiveFence: intersects a draft specialist fence with its team', () => {
  const fence = previewEffectiveFence({
    rootDir: readOnlyProject,
    draftSpecialist: { fence: { allowedPaths: ['docs/**', 'lib/**'] } },
    teamId: 'engineering-team',
  });
  assert.deepEqual(fence.allowedPaths, ['docs/**', 'lib/**']);
  assert.ok(fence.deniedActions.some((d) => d.startsWith('product-scope')));
});

test('previewRoute: scores the existing catalog against a description', () => {
  const architect = getEntity('specialist', 'architect', { rootDir: readOnlyProject });
  const { candidates } = previewRoute({ rootDir: readOnlyProject, description: architect.record.description });
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].id, 'architect');
});

// === Participation rules (construct-pteo2.15) ===

test('listParticipationRules: flattens the builtin declared rules with owner metadata', () => {
  const { items, count } = listParticipationRules({ rootDir: readOnlyProject });
  assert.ok(count >= 6, `the pteo2.6 coverage rules are declared, got ${count}`);
  const pmRule = items.find((it) => it.rule.id === 'cost-value-tradeoff-review');
  assert.ok(pmRule, 'product-manager cost rule is listed');
  assert.equal(pmRule.owner, 'product-manager');
  assert.equal(pmRule.ownerKind, 'specialist');
  assert.equal(pmRule.scope, 'builtin');
  const teamRule = items.find((it) => it.ownerKind === 'team');
  assert.ok(teamRule, 'team-attached rules are listed too');
});

test('validateParticipationRule: mirrors the coverage-gate structural contract', () => {
  const bad = validateParticipationRule('architect', {
    id: 'Bad Id', when: {}, recruit: {}, role: 'boss', gate: 'maybe', dimension: 'astrology', reason: 'x'.repeat(201),
  }, { rootDir: readOnlyProject });
  assert.equal(bad.ok, false);
  const ids = bad.errors.map((e) => e.id);
  for (const expected of ['participation-rule-id-shape', 'participation-when-missing', 'participation-recruit-empty', 'participation-role-enum', 'participation-gate-enum', 'participation-dimension-enum', 'participation-reason-too-long']) {
    assert.ok(ids.includes(expected), `expected ${expected} in ${JSON.stringify(ids)}`);
  }

  const unknownOwner = validateParticipationRule('cx-nobody', { id: 'r-one', when: { signalExpr: 'cost' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'advisory' }, { rootDir: readOnlyProject });
  assert.ok(unknownOwner.errors.some((e) => e.id === 'participation-owner-unknown'));

  const dupe = validateParticipationRule('architect', { id: 'cost-value-tradeoff-review', when: { signalExpr: 'cost' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'advisory' }, { rootDir: readOnlyProject });
  assert.ok(dupe.errors.some((e) => e.id === 'participation-rule-id-duplicate'), 'rule ids are unique registry-wide');

  const badExpr = validateParticipationRule('architect', { id: 'r-two', when: { signalExpr: 'cost || privacy' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'advisory' }, { rootDir: readOnlyProject });
  assert.ok(badExpr.errors.some((e) => e.id === 'participation-signal-expr-grammar'), '|| is outside the closed grammar');

  const unknownKey = validateParticipationRule('architect', { id: 'r-three', when: { signalExpr: 'made-up-signal' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'advisory' }, { rootDir: readOnlyProject });
  assert.equal(unknownKey.ok, true, 'unknown signal key is a warning, not an error');
  assert.ok(unknownKey.warnings.some((w) => w.id === 'participation-signal-key-unknown'));

  const legal = validateParticipationRule('architect', { id: 'r-four', dimension: 'legal-compliance', when: { signalExpr: 'compliance' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'advisory' }, { rootDir: readOnlyProject });
  assert.ok(legal.errors.some((e) => e.id === 'participation-legal-compliance-binding'), 'legal-compliance must recruit security');

  const enforcedBare = validateParticipationRule('architect', { id: 'r-five', when: { signalExpr: 'cost' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'enforced' }, { rootDir: readOnlyProject });
  assert.ok(enforcedBare.errors.some((e) => e.id === 'participation-enforcement-scope-missing'));

  const notOptedIn = validateParticipationRule('architect', { id: 'r-six', when: { signalExpr: 'cost' }, recruit: { specialists: ['qa'] }, role: 'reviewer', gate: 'enforced', enforcementScope: { team: 'engineering-team', decisionRight: 'right-nobody-declared' } }, { rootDir: readOnlyProject });
  assert.equal(notOptedIn.ok, true, 'not-yet-opted-in team is a warning (advisory-in-effect), not an error');
  assert.ok(notOptedIn.warnings.some((w) => w.id === 'participation-enforcement-not-opted-in'));
});

test('upsertParticipationRule: writes a partial project drop-in that preserves inherited rules', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const before = listParticipationRules({ rootDir: tmp }).items.filter((it) => it.owner === 'product-manager');
  assert.equal(before.length, 1, 'the builtin cost rule is the baseline');

  const rule = { id: 'privacy-product-review', when: { signalExpr: 'privacy' }, recruit: { specialists: ['product-manager'] }, role: 'advisor', gate: 'advisory', reason: 'privacy signal — product perspective' };
  const result = upsertParticipationRule('product-manager', rule, { rootDir: tmp, scope: 'project' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.path.startsWith(customOrgDir('project', { rootDir: tmp })), 'the write lands in the project tier');

  const dropIn = JSON.parse(fs.readFileSync(result.path, 'utf8'));
  assert.equal(dropIn.id, 'product-manager');
  assert.equal(dropIn.participationRules.rules.length, 2, 'the inherited builtin rule is preserved in the drop-in');
  assert.equal(dropIn.description, undefined, 'the drop-in is partial — no builtin fields copied');

  const after_ = listParticipationRules({ rootDir: tmp }).items.filter((it) => it.owner === 'product-manager');
  assert.equal(after_.length, 2);
  assert.equal(after_.every((it) => it.scope === 'project'), true, 'the project tier now sources the effective rules');

  const replaced = upsertParticipationRule('product-manager', { ...rule, role: 'reviewer' }, { rootDir: tmp, scope: 'project' });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.rules.filter((r) => r.id === 'privacy-product-review').length, 1, 'same-id upsert replaces, never duplicates');

  const refused = upsertParticipationRule('product-manager', rule, { rootDir: tmp, scope: 'builtin' });
  assert.equal(refused.ok, false);
  assert.equal(refused.errors[0].id, 'builtin-scope-readonly');
});

test('upsertParticipationRule: the recruiter sees a written rule identically to a builtin one', async () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // visualDeliverable has no canonical skill affinity, so the written rule is
  // the only path that can recruit here — proving the recruiter reads it.
  const rule = { id: 'visual-deliverable-design-review', when: { signalExpr: 'visualDeliverable' }, recruit: { specialists: ['designer'] }, role: 'reviewer', gate: 'advisory', reason: 'visual deliverable — design review' };
  const written = upsertParticipationRule('designer', rule, { rootDir: tmp, scope: 'project' });
  assert.equal(written.ok, true, JSON.stringify(written.errors));

  const { recruit } = await import('../../lib/orchestration/recruiter.mjs');
  const { assembleRegistry } = await import('../../lib/registry/assemble.mjs');
  const recruited = recruit({ signals: { visualDeliverable: true }, registry: assembleRegistry(tmp) });
  const designer = recruited.find((p) => p.specialist === 'designer' && p.rule === 'visual-deliverable-design-review');
  assert.ok(designer, `the live recruiter picks up the written rule: ${JSON.stringify(recruited)}`);
  assert.equal(designer.role, 'reviewer');
  assert.equal(designer.via, 'participation-rule');
});

test('removeParticipationRule: project-tier removal shadows a builtin rule', () => {
  const tmp = makeFixtureProject();
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const gone = removeParticipationRule('product-manager', 'cost-value-tradeoff-review', { rootDir: tmp, scope: 'project' });
  assert.equal(gone.ok, true, JSON.stringify(gone.errors));
  assert.equal(gone.rules.length, 0);
  assert.equal(listParticipationRules({ rootDir: tmp }).items.filter((it) => it.owner === 'product-manager').length, 0);

  const missing = removeParticipationRule('product-manager', 'no-such-rule', { rootDir: tmp, scope: 'project' });
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0].id, 'participation-rule-not-found');
});

test('previewParticipation: a sample request surfaces its recruited set with rationale', () => {
  const preview = previewParticipation({ rootDir: readOnlyProject, request: 'estimate the cost impact of the new pricing model, roughly $2M budget' });
  assert.equal(preview.signals.cost, true, 'the cost dimension fires from the sample text');
  const pm = preview.recruited.find((p) => p.specialist === 'product-manager');
  assert.ok(pm, 'the cost rule recruits the PM');
  assert.equal(pm.via, 'participation-rule');
  assert.ok(pm.reason, 'rationale travels with the recruit');
});

test('participationEditorMeta: palette carries watchers, signals, enums, and the roster', () => {
  const meta = participationEditorMeta({ rootDir: readOnlyProject });
  assert.ok(meta.watchers.includes('wide-blast-radius'));
  assert.ok(meta.signalKeys.includes('cost'));
  assert.deepEqual(meta.roles, ['author', 'reviewer', 'advisor']);
  assert.deepEqual(meta.gates, ['advisory', 'enforced']);
  assert.equal(meta.specialists.length, 12);
  assert.ok(meta.teams.length >= 8);
});
