/**
 * tests/artifact-manifest.test.mjs — artifact manifest loads and matches templates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artifactTypes,
  getArtifactEntry,
  resolveArtifactType,
  resolveArtifactWorkflowContract,
  templateMetadata,
  validateArtifactManifest,
} from '../lib/artifact-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('artifact manifest lists core doc types', () => {
  const types = artifactTypes({ rootDir: REPO });
  for (const t of ['prd', 'adr', 'research-brief', 'runbook', 'strategy']) {
    assert.ok(types.includes(t), `missing ${t}`);
  }
});

test('every manifest entry with template path resolves on disk', () => {
  for (const type of artifactTypes({ rootDir: REPO })) {
    const entry = getArtifactEntry(type, { rootDir: REPO });
    assert.ok(entry?.template, `${type} missing template`);
    assert.ok(existsSync(join(REPO, entry.template)), `${type} template missing: ${entry.template}`);
  }
});

test('templateMetadata exposes tone and release gate', () => {
  const meta = templateMetadata('prd', { rootDir: REPO });
  assert.equal(meta.tone, 'decision-forcing-direct');
  assert.ok(meta.releaseGate?.requiredReviewers?.includes('cx-devil-advocate'));
});

test('artifact workflow contract resolves any registered class and explicit override precedence', () => {
  const contract = resolveArtifactWorkflowContract('runbook', {
    rootDir: REPO,
    projectConfig: {
      artifactWorkflow: {
        defaults: { outputs: { branding: 'plain' } },
        types: { runbook: { outputs: { formats: ['html'] }, authorChain: ['cx-operations'] } },
      },
    },
    overrides: { outputs: { branding: 'construct' }, authorChain: ['cx-sre'] },
  });

  assert.equal(contract.status, 'registered');
  assert.equal(contract.type, 'runbook');
  assert.deepEqual(contract.authorChain, ['cx-sre']);
  assert.deepEqual(contract.outputs.formats, ['html']);
  assert.equal(contract.outputs.branding, 'construct');
  assert.deepEqual(contract.appliedOverrides, ['project.defaults', 'project.types.runbook', 'invocation']);
});

test('unrecognized artifact classes require classification or registration', () => {
  const result = resolveArtifactType('customer-whitepaper', { rootDir: REPO });
  assert.equal(result.status, 'unrecognized');
  assert.match(result.guidance, /not registered/i);
});

test('artifact manifest validator reports invalid workflow declarations', () => {
  const result = validateArtifactManifest({
    version: 2,
    artifacts: { broken: { template: 'x.md', primaryOwners: [], outputs: { branding: 'violet' } } },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('outputs.branding')));
});
