/**
 * tests/registry/org-api.test.mjs — ADR-0072 no-code org authoring API CRUD gate.
 *
 * Every test runs against an isolated tmpdir project seeded with a copy of
 * the repo's real specialists/org/** fixture (12 specialists, 35 contracts,
 * 8 teams + 6 groups, verified at ADR-0072 authoring time) — never against
 * the real repo's specialists/org/ or .construct/org/. CX_HOME_OVERRIDE
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
} from '../../lib/registry/org-api.mjs';

const REPO_ROOT = process.cwd();

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'org-api-home-'));
const originalHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
after(() => {
  if (originalHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = originalHomeOverride;
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
  assert.equal(contracts.count, 35);
});

test('listEntities/getEntity: fence resolves to the owning specialist sub-object', () => {
  const fences = listEntities('fence', { rootDir: readOnlyProject });
  assert.equal(fences.count, 12);

  const fence = getEntity('fence', 'cx-architect', { rootDir: readOnlyProject });
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
  const architect = getEntity('specialist', 'cx-architect', { rootDir: readOnlyProject });
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
  assert.equal(fs.existsSync(path.join(tmp, '.construct', 'org', 'specialists', 'cx-broken-widget.json')), false);
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
  assert.ok(fs.existsSync(path.join(tmp, '.construct', 'org', 'teams', 'qa-temp-team.json')));

  const forced = removeEntity('team', 'qa-temp-team', { rootDir: tmp, scope: 'project', force: true });
  assert.equal(forced.ok, true, JSON.stringify(forced.errors));
  assert.equal(fs.existsSync(path.join(tmp, '.construct', 'org', 'teams', 'qa-temp-team.json')), false);
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
  assert.equal(fs.existsSync(path.join(tmp, '.construct', 'org', 'specialists', 'cx-dry-run-widget.json')), false);
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
  const architect = getEntity('specialist', 'cx-architect', { rootDir: readOnlyProject });
  const { candidates } = previewRoute({ rootDir: readOnlyProject, description: architect.record.description });
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].id, 'cx-architect');
});
