/**
 * tests/artifact-manifest.test.mjs — artifact manifest loads and matches templates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactTypes, getArtifactEntry, templateMetadata } from '../lib/artifact-manifest.mjs';

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
