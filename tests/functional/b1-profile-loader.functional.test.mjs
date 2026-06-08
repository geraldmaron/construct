/**
 * tests/functional/b1-profile-loader.functional.test.mjs — B1 end-to-end loop.
 *
 * Validates the profile resolution path the way `construct init` / `construct
 * sync` would invoke it. Confirms each curated profile loads, each ships an
 * intake table that the classifier can use, and the escape hatch (custom
 * profile in .cx/profile.json) overrides the default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listProfiles, loadProfile, resolveActiveProfile } from '../../lib/profiles/loader.mjs';
import { classifyRdIntake } from '../../lib/intake/classify.mjs';

const PRINCIPLED_PROFILES = ['rnd', 'operations', 'creative', 'research'];

test('every curated profile classifies a representative input through its own intake table', () => {
  const samples = {
    rnd: { sourcePath: 'arch.md', extractedText: 'system design tradeoff data model', expectedOwner: 'architect' },
    operations: { sourcePath: 'req.md', extractedText: 'change request for new access', expectedOwner: 'operator' },
    creative: { sourcePath: 'brief.md', extractedText: 'campaign launch plan audience', expectedOwner: 'product-lead' },
    research: { sourcePath: 'q.md', extractedText: 'research question investigate why', expectedOwner: 'researcher' },
  };

  for (const id of PRINCIPLED_PROFILES) {
    const p = loadProfile(id);
    assert.ok(p, `profile ${id} did not load`);
    const triage = classifyRdIntake({ ...samples[id], profile: id });
    assert.equal(
      triage.primaryOwner,
      samples[id].expectedOwner,
      `[${id}] expected owner ${samples[id].expectedOwner}, got ${triage.primaryOwner} (intakeType=${triage.intakeType})`,
    );
  }
});

test('escape hatch: .cx/profile.json with custom:true overrides the default', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-functional-custom-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.cx', 'profile.json'), JSON.stringify({
    id: 'game-studio',
    displayName: 'My Game Studio',
    custom: true,
    roles: ['game-designer', 'engineer', 'qa'],
    intake: { types: ['feature', 'bug', 'balance'], stages: ['design', 'prototype', 'playtest'] },
  }));
  const p = resolveActiveProfile(cwd);
  assert.equal(p.id, 'game-studio');
  assert.equal(p.custom, true);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('curated catalog stays at four principled profiles', () => {
  const ids = listProfiles();
  assert.equal(ids.length, PRINCIPLED_PROFILES.length, `curated catalog drifted: got ${ids.join(',')}`);
  for (const id of PRINCIPLED_PROFILES) assert.ok(ids.includes(id));
});
