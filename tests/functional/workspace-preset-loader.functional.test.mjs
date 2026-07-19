import assert from 'node:assert/strict';
import test from 'node:test';

import { listWorkspacePresets, loadWorkspacePreset } from '../../lib/workspace-presets/loader.mjs';
import { classifyRdIntake } from '../../lib/intake/classify.mjs';

const PRESET_IDS = ['creative', 'operations', 'research', 'rnd'];

test('each Workspace Preset classifies input through its intake table', () => {
  const samples = {
    rnd: { sourcePath: 'arch.md', extractedText: 'system design tradeoff data model', expectedOwner: 'architect' },
    operations: { sourcePath: 'req.md', extractedText: 'change request for new access', expectedOwner: 'operations' },
    creative: { sourcePath: 'brief.md', extractedText: 'campaign launch plan audience', expectedOwner: 'product-manager' },
    research: { sourcePath: 'q.md', extractedText: 'research question investigate why', expectedOwner: 'researcher' },
  };
  for (const id of PRESET_IDS) {
    const workspacePreset = loadWorkspacePreset(id);
    const triage = classifyRdIntake({ ...samples[id], workspacePreset });
    assert.equal(triage.primaryOwner, samples[id].expectedOwner, `${id}: ${triage.intakeType}`);
  }
});

test('Workspace Preset catalog remains canonical', () => {
  assert.deepEqual(listWorkspacePresets(), PRESET_IDS);
});
