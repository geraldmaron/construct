/**
 * tests/functional/b1-profile-loader.functional.test.mjs — B1 end-to-end loop.
 *
 * Validates the scope resolution path the way `construct init` / `construct
 * sync` would invoke it. Confirms each curated scope loads, each ships an
 * intake table that the classifier can use, and the escape hatch (custom
 * scope in .construct/scope.json) overrides the default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listScopes, loadScope, resolveActiveScope } from '../../lib/scopes/loader.mjs';
import { classifyRdIntake } from '../../lib/intake/classify.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const PRINCIPLED_SCOPES = ['rnd', 'operations', 'creative', 'research'];

test('every curated scope classifies a representative input through its own intake table', () => {
  const samples = {
    rnd: { sourcePath: 'arch.md', extractedText: 'system design tradeoff data model', expectedOwner: 'architect' },
    operations: { sourcePath: 'req.md', extractedText: 'change request for new access', expectedOwner: 'operations' },
    creative: { sourcePath: 'brief.md', extractedText: 'campaign launch plan audience', expectedOwner: 'product-manager' },
    research: { sourcePath: 'q.md', extractedText: 'research question investigate why', expectedOwner: 'researcher' },
  };

  for (const id of PRINCIPLED_SCOPES) {
    const p = loadScope(id);
    assert.ok(p, `scope ${id} did not load`);
    const triage = classifyRdIntake({ ...samples[id], profile: id });
    assert.equal(
      triage.primaryOwner,
      samples[id].expectedOwner,
      `[${id}] expected owner ${samples[id].expectedOwner}, got ${triage.primaryOwner} (intakeType=${triage.intakeType})`,
    );
  }
});

test('escape hatch: .construct/scope.json with custom:true overrides the default', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'b1-functional-custom-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'scope.json'), JSON.stringify({
    id: 'game-studio',
    displayName: 'My Game Studio',
    custom: true,
    roles: ['game-designer', 'engineer', 'qa'],
    intake: { types: ['feature', 'bug', 'balance'], stages: ['design', 'prototype', 'playtest'] },
  }));
  const p = resolveActiveScope(cwd);
  assert.equal(p.id, 'game-studio');
  assert.equal(p.custom, true);
  rmTmpDir(cwd);
});

test('curated catalog stays at four principled scopes', () => {
  const ids = listScopes();
  assert.equal(ids.length, PRINCIPLED_SCOPES.length, `curated catalog drifted: got ${ids.join(',')}`);
  for (const id of PRINCIPLED_SCOPES) assert.ok(ids.includes(id));
});
