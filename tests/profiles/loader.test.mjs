/**
 * tests/profiles/loader.test.mjs — Profile loader contract.
 *
 * Checks the curated catalog loads, custom profiles override correctly, the
 * default fallback works, and every shipped profile conforms to the schema.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  DEFAULT_SCOPE_ID,
  listScopes,
  loadCustomScope,
  loadScope,
  resolveActiveScope,
} from '../../lib/scopes/loader.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
function track(dir) { tmpDirs.push(dir); return dir; }

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'scope.schema.json'), 'utf8'));

test('curated catalog ships the four work-loop scopes: rnd, operations, creative, research', () => {
  const ids = listScopes();
  for (const required of ['rnd', 'operations', 'creative', 'research']) {
    assert.ok(ids.includes(required), `missing curated profile: ${required}`);
  }
  // Verticals (game studios, agencies, etc) belong in the escape hatch, not
  // the curated set. Guard against re-introducing them by accident.
  for (const forbidden of ['marketing', 'game-studio', 'internal-tools']) {
    assert.equal(ids.includes(forbidden), false, `non-principled scope must not be in catalog: ${forbidden}`);
  }
});

test('loadScope returns null for unknown id', () => {
  assert.equal(loadScope('does-not-exist'), null);
  assert.equal(loadScope(''), null);
  assert.equal(loadScope(null), null);
});

test('loadScope reads the curated rnd scope', () => {
  const p = loadScope('rnd');
  assert.ok(p);
  assert.equal(p.id, 'rnd');
  assert.ok(Array.isArray(p.roles) && p.roles.length > 0);
  assert.ok(p.intake.types.includes('bug'));
});

test('resolveActiveScope defaults to rnd when nothing is configured', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-default-')));
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, DEFAULT_SCOPE_ID);
});

test('resolveActiveScope reads construct.config.json scope field', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-from-config-')));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    scope: 'creative',
  }));
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, 'creative', 'construct.config.json scope field must be honored');
});

test('resolveActiveScope precedence: custom .construct/scope.json beats construct.config.json', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-precedence-')));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    scope: 'creative',
  }));
  fs.writeFileSync(path.join(cwd, '.construct', 'scope.json'), JSON.stringify({
    id: 'project-special',
    displayName: 'Project Special',
    custom: true,
    roles: ['x'],
    intake: { types: ['x'], stages: ['x'] },
  }));
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, 'project-special', 'custom scope must override construct.config.json');
});

test('resolveActiveScope precedence: explicit id beats both files', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-explicit-')));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    scope: 'creative',
  }));
  const p = resolveActiveScope(cwd, 'operations');
  assert.equal(p.id, 'operations');
});

test('resolveActiveScope honors construct.config scope id', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-config-')));
  const p = resolveActiveScope(cwd, 'creative');
  assert.equal(p.id, 'creative');
});

test('resolveActiveScope picks up custom scope from .construct/scope.json', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-custom-')));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.construct', 'scope.json'),
    JSON.stringify({
      id: 'my-studio',
      displayName: 'My Studio',
      custom: true,
      roles: ['designer', 'engineer'],
      intake: { types: ['request'], stages: ['build'] },
    }, null, 2),
  );
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, 'my-studio');
  assert.equal(p.custom, true);
});

test('resolveActiveScope ignores .construct/scope.json without custom: true', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-not-custom-')));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.construct', 'scope.json'),
    JSON.stringify({ id: 'malicious', roles: [], intake: { types: [], stages: [] } }),
  );
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, DEFAULT_SCOPE_ID);
});

test('loadCustomScope returns null for missing / malformed file', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bad-')));
  assert.equal(loadCustomScope(cwd), null);
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'scope.json'), '{ this is not json');
  assert.equal(loadCustomScope(cwd), null);
});

// construct-rf26.14: named custom scopes reuse the construct-rf26.13
// builtin -> user -> project config-layer precedence (lib/registry/assemble.mjs)
// instead of a scope-specific mechanism.

test('loadScope resolves a named custom scope from the project tier (.construct/org/worker-profiles/)', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-project-tier-')));
  const dir = path.join(cwd, '.construct', 'org', 'worker-profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'media-agency.json'), JSON.stringify({
    id: 'media-agency',
    displayName: 'Media Agency',
    intake: { types: ['brief'], stages: ['brief'] },
  }));
  const p = loadScope('media-agency', { cwd });
  assert.ok(p, 'project-tier custom scope must resolve by id');
  assert.equal(p.displayName, 'Media Agency');
});

test('loadScope resolves a named custom scope from the user tier (~/.construct/org/worker-profiles/)', () => {
  const home = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-user-tier-home-')));
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-user-tier-cwd-')));
  const dir = path.join(home, '.construct', 'org', 'worker-profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'studio-x.json'), JSON.stringify({
    id: 'studio-x',
    displayName: 'Studio X',
    intake: { types: ['ticket'], stages: ['triage'] },
  }));
  const priorOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  try {
    const p = loadScope('studio-x', { cwd });
    assert.ok(p, 'user-tier custom scope must resolve by id');
    assert.equal(p.displayName, 'Studio X');
  } finally {
    if (priorOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = priorOverride;
  }
});

test('loadScope precedence: project tier overrides user tier, which overrides builtin, on id collision', () => {
  const home = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-precedence-home-')));
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-precedence-cwd-')));
  const userDir = path.join(home, '.construct', 'org', 'worker-profiles');
  const projectDir = path.join(cwd, '.construct', 'org', 'worker-profiles');
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  // Same id at every tier; only displayName differs, so a resolved value
  // proves which tier(s) actually won.
  fs.writeFileSync(path.join(userDir, 'rnd.json'), JSON.stringify({
    id: 'rnd', displayName: 'RND (user tier)',
  }));
  const priorOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  try {
    let p = loadScope('rnd', { cwd });
    assert.equal(p.displayName, 'RND (user tier)', 'user tier must override builtin');

    fs.writeFileSync(path.join(projectDir, 'rnd.json'), JSON.stringify({
      id: 'rnd', displayName: 'RND (project tier)',
    }));
    p = loadScope('rnd', { cwd });
    assert.equal(p.displayName, 'RND (project tier)', 'project tier must override user tier and builtin');
    // Fields the overlay didn't set still come from the builtin curated scope.
    assert.ok(Array.isArray(p.intake?.types) && p.intake.types.length > 0, 'unset fields fall back to the builtin tier');
  } finally {
    if (priorOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = priorOverride;
  }
});

test('resolveActiveScope honors a project-tier named custom scope by explicit id', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-active-project-tier-')));
  const dir = path.join(cwd, '.construct', 'org', 'worker-profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'game-studio.json'), JSON.stringify({
    id: 'game-studio',
    displayName: 'Game Studio',
    intake: { types: ['playtest'], stages: ['triage'] },
  }));
  const p = resolveActiveScope(cwd, 'game-studio');
  assert.equal(p.id, 'game-studio');
  assert.equal(p.displayName, 'Game Studio');
});

test('every curated scope conforms to scope.schema.json shape', () => {
  // Lightweight schema check: required top-level fields exist and types match.
  // Full draft-07 validation would pull in a dep; this catches the common drift.
  for (const id of listScopes()) {
    const p = loadScope(id);
    assert.ok(p, `scope ${id} did not load`);
    for (const required of SCHEMA.required) {
      assert.ok(required in p, `scope ${id} missing required field "${required}"`);
    }
    assert.ok(/^[a-z][a-z0-9-]{1,30}$/.test(p.id), `scope ${id} id pattern violation`);
    assert.ok(Array.isArray(p.roles), `scope ${id} roles not array`);
    assert.ok(p.roles.length <= 80, `scope ${id} exceeds 80-role cap`);
    assert.ok(Array.isArray(p.intake.types), `scope ${id} intake.types not array`);
    assert.ok(p.intake.types.length <= 24, `scope ${id} exceeds 24-intake-type cap`);
    assert.ok(p.intake.stages.length <= 12, `scope ${id} exceeds 12-stage cap`);
  }
});

test('every curated scope declares departments with real charters when departments are present', () => {
  for (const id of listScopes()) {
    const p = loadScope(id);
    if (!Array.isArray(p.departments) || p.departments.length === 0) continue;
    const allRoles = new Set(p.roles);
    for (const dept of p.departments) {
      assert.ok(dept.id && /^[a-z][a-z0-9-]+$/.test(dept.id), `${id}.${dept.id}: bad id`);
      assert.ok(dept.charter && dept.charter.length >= 20,
        `${id}.${dept.id}.charter must be a real mission statement, not a label`);
      assert.ok(Array.isArray(dept.roles) && dept.roles.length > 0, `${id}.${dept.id}.roles empty`);
      for (const r of dept.roles) {
        assert.ok(allRoles.has(r), `${id}.${dept.id} role ${r} not in profile.roles`);
      }
    }
  }
});

test('every role belongs to exactly one department in each curated scope', () => {
  for (const id of listScopes()) {
    const p = loadScope(id);
    if (!Array.isArray(p.departments)) continue;
    const homes = new Map();
    for (const dept of p.departments) {
      for (const r of dept.roles) {
        if (homes.has(r)) {
          assert.fail(`${id}: role ${r} in both ${homes.get(r)} and ${dept.id}`);
        }
        homes.set(r, dept.id);
      }
    }
    for (const r of p.roles) {
      assert.ok(homes.has(r), `${id}: role ${r} declared but not assigned to any department`);
    }
  }
});
