/**
 * tests/asset-quality/completion-states.test.mjs — Keeps the completion-state vocabulary single.
 *
 * The ordered enum lives in lib/artifact-completion-states.mjs and is mirrored in the manifest
 * schema ($defs.completionState). This test fails if the two drift, so the manifest, validator,
 * and the schema can never disagree on what the rungs are. It also exercises the ordering helper
 * and confirms the manifest validator rejects a qualityContract requiredState outside the enum.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLETION_STATES,
  isCompletionState,
  completionRank,
} from '../../lib/artifact-completion-states.mjs';
import { validateArtifactManifest } from '../../lib/artifact-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the JS enum is byte-identical to the manifest schema completionState enum', () => {
  const schema = JSON.parse(readFileSync(resolve(REPO, 'specialists/artifact-manifest.schema.json'), 'utf8'));
  const schemaStates = schema.$defs.completionState.enum;
  assert.deepEqual([...COMPLETION_STATES], schemaStates);
});

test('the ladder is ordered: each rung ranks after the previous', () => {
  for (let i = 1; i < COMPLETION_STATES.length; i++) {
    assert.ok(completionRank(COMPLETION_STATES[i]) > completionRank(COMPLETION_STATES[i - 1]));
  }
  assert.equal(completionRank('not-a-state'), -1);
  assert.equal(isCompletionState('exported'), true);
  assert.equal(isCompletionState('shipped'), false);
});

test('the manifest validator rejects a qualityContract requiredState outside the enum', () => {
  const result = validateArtifactManifest({
    version: 2,
    artifacts: {
      broken: {
        template: 'x.md',
        primaryOwners: ['cx-product-manager'],
        qualityContract: { requiredStates: ['exported', 'shipped'] },
      },
    },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('qualityContract.requiredStates')));
});
