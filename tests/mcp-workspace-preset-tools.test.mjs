/**
 * mcp-workspace-preset-tools.test.mjs — canonical Construct contract coverage.
 *
 * Assertions pin the clean-slate public model and reject retired terminology.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  outcomesRecord,
  workspacePresetArchive,
  workspacePresetCreate,
  workspacePresetDrafts,
  workspacePresetHealthTool,
  workspacePresetList,
  workspacePresetShow,
} from '../lib/mcp/tools/workspace-preset.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
function project(id = 'rnd') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-workspace-preset-mcp-'));
  tmpDirs.push(cwd);
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ workspacePreset: id }));
  return cwd;
}

test('workspace_preset_show returns the configured canonical shape', () => {
  const result = workspacePresetShow({ cwd: project('operations') });
  assert.equal(result.id, 'operations');
  assert.ok(Array.isArray(result.skills));
  assert.ok(Array.isArray(result.procedures));
  assert.ok(Array.isArray(result.artifactClasses));
  assert.ok(Array.isArray(result.intake.types));
});

test('workspace_preset_list returns the canonical catalog', () => {
  const result = workspacePresetList();
  assert.ok(Array.isArray(result.workspacePresets));
  assert.ok(result.workspacePresets.some((preset) => preset.id === 'rnd'));
  assert.ok(result.workspacePresets.every((preset) => Number.isInteger(preset.skillCount)));
});

test('workspace_preset_drafts and workspace_preset_create share canonical paths', () => {
  const cwd = project();
  assert.deepEqual(workspacePresetDrafts({ cwd }), { drafts: [] });
  assert.match(workspacePresetCreate({ cwd, id: 'draft-one' }).error, /confirm=true/);
  const created = workspacePresetCreate({ cwd, confirm: true, id: 'draft-one', display_name: 'Draft One' });
  assert.equal(created.ok, true);
  assert.ok(fs.existsSync(path.join(cwd, '.construct', 'workspace-presets', 'draft-draft-one', 'workspace-preset.json')));
  assert.equal(workspacePresetDrafts({ cwd }).drafts[0].hasWorkspacePreset, true);
});

test('workspace_preset_health returns a deterministic empty rollup', () => {
  const result = workspacePresetHealthTool({ cwd: project(), id: 'rnd', window_days: 7 });
  assert.equal(result.id, 'rnd');
  assert.equal(result.windowDays, 7);
  assert.deepEqual(result.workerHealth, {});
});

test('workspace_preset_archive requires confirmation and a substantive reason', () => {
  assert.match(workspacePresetArchive({ id: 'rnd', reason: 'retire preset' }).error, /confirm=true/);
  assert.match(workspacePresetArchive({ confirm: true, id: 'rnd', reason: 'short' }).error, /reason:string/);
});

test('outcomes_record stamps the active Workspace Preset', () => {
  const cwd = project('creative');
  const result = outcomesRecord({ cwd, confirm: true, role: 'engineer', success: true });
  assert.equal(result.ok, true);
  const entry = JSON.parse(fs.readFileSync(path.join(cwd, '.construct', 'outcomes', 'engineer.jsonl'), 'utf8'));
  assert.equal(entry.workspacePreset, 'creative');
  assert.equal(Object.hasOwn(entry, 'profile'), false);
});
