import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  DEFAULT_WORKSPACE_PRESET_ID,
  listWorkspacePresets,
  loadWorkspacePreset,
  resolveActiveWorkspacePreset,
} from '../../lib/workspace-presets/loader.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'workspace-preset.schema.json'), 'utf8'));
const PRESET_IDS = ['creative', 'operations', 'research', 'rnd'];

test('canonical Workspace Preset catalog contains the four current presets', () => {
  assert.deepEqual(listWorkspacePresets(), PRESET_IDS);
});

test('loadWorkspacePreset reads canonical records and rejects unknown ids', () => {
  const preset = loadWorkspacePreset('rnd');
  assert.equal(preset.id, 'rnd');
  assert.ok(preset.skills.includes('docs/prd-workflow'));
  assert.ok(preset.intake.types.includes('bug'));
  assert.equal(loadWorkspacePreset('does-not-exist'), null);
  assert.equal(loadWorkspacePreset(''), null);
});

test('resolveActiveWorkspacePreset defaults to rnd', () => {
  const preset = resolveActiveWorkspacePreset(tmp('workspace-preset-default-'));
  assert.equal(preset.id, DEFAULT_WORKSPACE_PRESET_ID);
});

test('resolveActiveWorkspacePreset reads construct.config.json workspacePreset', () => {
  const cwd = tmp('workspace-preset-config-');
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ workspacePreset: 'creative' }));
  assert.equal(resolveActiveWorkspacePreset(cwd).id, 'creative');
});

test('explicit Workspace Preset id takes precedence over project config', () => {
  const cwd = tmp('workspace-preset-explicit-');
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ workspacePreset: 'creative' }));
  assert.equal(resolveActiveWorkspacePreset(cwd, 'operations').id, 'operations');
});

test('retired scope fields and files do not affect resolution', () => {
  const cwd = tmp('workspace-preset-no-compat-');
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ scope: 'creative' }));
  fs.writeFileSync(path.join(cwd, '.construct', 'scope.json'), JSON.stringify({ id: 'operations' }));
  assert.equal(resolveActiveWorkspacePreset(cwd).id, DEFAULT_WORKSPACE_PRESET_ID);
});

test('every Workspace Preset satisfies the canonical schema shape', () => {
  for (const id of listWorkspacePresets()) {
    const preset = loadWorkspacePreset(id);
    for (const required of SCHEMA.required) assert.ok(required in preset, `${id} missing ${required}`);
    assert.match(preset.id, /^[a-z][a-z0-9-]{1,30}$/);
    assert.ok(Array.isArray(preset.skills));
    assert.ok(Array.isArray(preset.procedures));
    assert.ok(Array.isArray(preset.artifactClasses));
    assert.ok(Array.isArray(preset.intake.types));
    assert.ok(Array.isArray(preset.intake.stages));
    for (const retired of ['roles', 'teams', 'departments', 'extends', 'custom', 'defaultSkills', 'docTemplates']) {
      assert.equal(Object.hasOwn(preset, retired), false, `${id} contains retired field ${retired}`);
    }
  }
});
