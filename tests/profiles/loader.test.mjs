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
  DEFAULT_PROFILE_ID,
  listProfiles,
  loadCustomProfile,
  loadProfile,
  resolveActiveProfile,
} from '../../lib/profiles/loader.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
function track(dir) { tmpDirs.push(dir); return dir; }

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'profile.schema.json'), 'utf8'));

test('curated catalog ships the four work-loop profiles: rnd, operations, creative, research', () => {
  const ids = listProfiles();
  for (const required of ['rnd', 'operations', 'creative', 'research']) {
    assert.ok(ids.includes(required), `missing curated profile: ${required}`);
  }
  // Verticals (game studios, agencies, etc) belong in the escape hatch, not
  // the curated set. Guard against re-introducing them by accident.
  for (const forbidden of ['marketing', 'game-studio', 'internal-tools']) {
    assert.equal(ids.includes(forbidden), false, `non-principled profile must not be in catalog: ${forbidden}`);
  }
});

test('loadProfile returns null for unknown id', () => {
  assert.equal(loadProfile('does-not-exist'), null);
  assert.equal(loadProfile(''), null);
  assert.equal(loadProfile(null), null);
});

test('loadProfile reads the curated rnd profile', () => {
  const p = loadProfile('rnd');
  assert.ok(p);
  assert.equal(p.id, 'rnd');
  assert.ok(Array.isArray(p.roles) && p.roles.length > 0);
  assert.ok(p.intake.types.includes('bug'));
});

test('resolveActiveProfile defaults to rnd when nothing is configured', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-default-')));
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, DEFAULT_PROFILE_ID);
});

test('resolveActiveProfile reads construct.config.json profile field', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-from-config-')));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    profile: 'creative',
  }));
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, 'creative', 'construct.config.json profile field must be honored');
});

test('resolveActiveProfile precedence: custom .cx/profile.json beats construct.config.json', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-precedence-')));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    profile: 'creative',
  }));
  fs.writeFileSync(path.join(cwd, '.cx', 'profile.json'), JSON.stringify({
    id: 'project-special',
    displayName: 'Project Special',
    custom: true,
    roles: ['x'],
    intake: { types: ['x'], stages: ['x'] },
  }));
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, 'project-special', 'custom profile must override construct.config.json');
});

test('resolveActiveProfile precedence: explicit id beats both files', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-explicit-')));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    profile: 'creative',
  }));
  const p = resolveActiveProfile(cwd, 'operations');
  assert.equal(p.id, 'operations');
});

test('resolveActiveProfile honors construct.config profile id', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-config-')));
  const p = resolveActiveProfile(cwd, 'creative');
  assert.equal(p.id, 'creative');
});

test('resolveActiveProfile picks up custom profile from .cx/profile.json', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-custom-')));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.cx', 'profile.json'),
    JSON.stringify({
      id: 'my-studio',
      displayName: 'My Studio',
      custom: true,
      roles: ['designer', 'engineer'],
      intake: { types: ['request'], stages: ['build'] },
    }, null, 2),
  );
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, 'my-studio');
  assert.equal(p.custom, true);
});

test('resolveActiveProfile ignores .cx/profile.json without custom: true', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-not-custom-')));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.cx', 'profile.json'),
    JSON.stringify({ id: 'malicious', roles: [], intake: { types: [], stages: [] } }),
  );
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, DEFAULT_PROFILE_ID);
});

test('loadCustomProfile returns null for missing / malformed file', () => {
  const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bad-')));
  assert.equal(loadCustomProfile(cwd), null);
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cx', 'profile.json'), '{ this is not json');
  assert.equal(loadCustomProfile(cwd), null);
});

test('every curated profile conforms to profile.schema.json shape', () => {
  // Lightweight schema check: required top-level fields exist and types match.
  // Full draft-07 validation would pull in a dep; this catches the common drift.
  for (const id of listProfiles()) {
    const p = loadProfile(id);
    assert.ok(p, `profile ${id} did not load`);
    for (const required of SCHEMA.required) {
      assert.ok(required in p, `profile ${id} missing required field "${required}"`);
    }
    assert.ok(/^[a-z][a-z0-9-]{1,30}$/.test(p.id), `profile ${id} id pattern violation`);
    assert.ok(Array.isArray(p.roles), `profile ${id} roles not array`);
    assert.ok(p.roles.length <= 80, `profile ${id} exceeds 80-role cap`);
    assert.ok(Array.isArray(p.intake.types), `profile ${id} intake.types not array`);
    assert.ok(p.intake.types.length <= 24, `profile ${id} exceeds 24-intake-type cap`);
    assert.ok(p.intake.stages.length <= 12, `profile ${id} exceeds 12-stage cap`);
  }
});

test('every curated profile declares departments with real charters', () => {
  for (const id of listProfiles()) {
    const p = loadProfile(id);
    assert.ok(Array.isArray(p.departments) && p.departments.length > 0,
      `profile ${id} should declare departments (organizational research, not a flat role list)`);
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

test('every role belongs to exactly one department in each curated profile', () => {
  for (const id of listProfiles()) {
    const p = loadProfile(id);
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
