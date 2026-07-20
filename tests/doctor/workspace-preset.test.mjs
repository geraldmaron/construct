/**
 * tests/doctor/workspace-preset.test.mjs — doctor echoes active Workspace Preset.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';
import { checkWorkspacePresetForDoctor } from '../../lib/doctor/workspace-preset.mjs';

test('skips outside a Construct project', () => {
  const dir = tempDir('doctor-preset-');
  try {
    const result = checkWorkspacePresetForDoctor(dir);
    assert.equal(result.run, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('warns when construct.config.json lacks workspacePreset', () => {
  const dir = tempDir('doctor-preset-');
  try {
    fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'construct.config.json'), `${JSON.stringify({ version: 1 }, null, 2)}\n`);
    const result = checkWorkspacePresetForDoctor(dir, {
      listPresets: () => ['rnd', 'creative'],
      loadPreset: () => null,
    });
    assert.equal(result.run, true);
    assert.equal(result.pass, false);
    assert.equal(result.optional, true);
    assert.match(result.label, /Workspace Preset not set/);
    assert.match(result.label, /construct workspace-preset list/);
    assert.match(result.label, /construct workspace-preset apply <id>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passes with active preset id and show hint', () => {
  const dir = tempDir('doctor-preset-');
  try {
    fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'construct.config.json'),
      `${JSON.stringify({ version: 1, workspacePreset: 'creative' }, null, 2)}\n`,
    );
    const result = checkWorkspacePresetForDoctor(dir, {
      loadPreset: (id) => (id === 'creative' ? { id: 'creative', displayName: 'Creative' } : null),
      listPresets: () => ['creative', 'rnd'],
    });
    assert.equal(result.run, true);
    assert.equal(result.pass, true);
    assert.match(result.label, /Workspace Preset: creative \(Creative\)/);
    assert.match(result.label, /construct workspace-preset show/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails on unknown configured preset id', () => {
  const dir = tempDir('doctor-preset-');
  try {
    fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'construct.config.json'),
      `${JSON.stringify({ version: 1, workspacePreset: 'nope' }, null, 2)}\n`,
    );
    const result = checkWorkspacePresetForDoctor(dir, {
      loadPreset: () => null,
      listPresets: () => ['rnd'],
    });
    assert.equal(result.run, true);
    assert.equal(result.pass, false);
    assert.equal(result.optional, false);
    assert.match(result.label, /Workspace Preset 'nope' unknown/);
    assert.match(result.label, /construct workspace-preset apply <id>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
