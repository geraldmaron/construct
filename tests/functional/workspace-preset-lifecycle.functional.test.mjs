/**
 * workspace-preset-lifecycle.functional.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  archiveWorkspacePreset,
  createDraftWorkspacePreset,
  listDrafts,
  workspacePresetHealth,
} from '../../lib/workspace-presets/lifecycle.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('createDraftWorkspacePreset creates the canonical draft pair', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-create-'));
  const result = createDraftWorkspacePreset({ cwd, id: 'media-agency', displayName: 'Media Agency' });
  const draft = JSON.parse(fs.readFileSync(result.draftPath, 'utf8'));
  assert.equal(draft.id, 'media-agency');
  assert.equal(path.basename(result.draftPath), 'workspace-preset.json');
  assert.deepEqual(draft.skills, []);
  assert.deepEqual(draft.procedures, []);
  assert.deepEqual(draft.artifactClasses, []);
  assert.match(fs.readFileSync(result.briefPath, 'utf8'), /Workspace Preset requirements/);
  rmTmpDir(cwd);
});

test('draft creation rejects catalog collisions and overwrites', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-collision-'));
  assert.throws(() => createDraftWorkspacePreset({ cwd, id: 'rnd' }), /already exists/);
  createDraftWorkspacePreset({ cwd, id: 'studio-x' });
  assert.throws(() => createDraftWorkspacePreset({ cwd, id: 'studio-x' }), /already exists/);
  rmTmpDir(cwd);
});

test('listDrafts reports Workspace Preset draft contents', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-list-'));
  createDraftWorkspacePreset({ cwd, id: 'one' });
  createDraftWorkspacePreset({ cwd, id: 'two' });
  const drafts = listDrafts(cwd).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(drafts.map((draft) => draft.id), ['one', 'two']);
  assert.ok(drafts.every((draft) => draft.hasBrief && draft.hasWorkspacePreset));
  rmTmpDir(cwd);
});

test('workspacePresetHealth filters outcomes by Workspace Preset', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-health-'));
  const dir = path.join(cwd, '.construct', 'outcomes');
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(dir, 'engineer.jsonl'), [
    { timestamp, workspacePreset: 'rnd', success: true },
    { timestamp, workspacePreset: 'rnd', success: false },
    { timestamp, workspacePreset: 'creative', success: true },
  ].map(JSON.stringify).join('\n'));
  const report = workspacePresetHealth(cwd, 'rnd');
  assert.equal(report.workerHealth.engineer.runs, 2);
  assert.equal(report.workerHealth.engineer.successRate, 0.5);
  rmTmpDir(cwd);
});

test('archiveWorkspacePreset requires a substantive reason', () => {
  assert.throws(() => archiveWorkspacePreset({ id: 'rnd', reason: '' }), /substantive reason/);
  assert.throws(() => archiveWorkspacePreset({ id: 'rnd', reason: 'idk' }), /substantive reason/);
});
