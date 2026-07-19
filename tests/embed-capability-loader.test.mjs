import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { embedProjectDir, loadEmbedCapabilities, validateEmbedBlock } from '../lib/embed/capability-loader.mjs';
import { disableCapability, enableCapability, listCapabilities } from '../lib/embed/capability-lifecycle.mjs';

const record = (overrides = {}) => ({
  id: 'sample-embed', version: '1.0.0', type: 'embed', workerProfiles: [],
  approvalMode: 'proposal-only', modelTier: 'standard', state: 'active',
  description: 'Sample embedded Procedure',
  embed: {
    workerProfileId: 'operations',
    providerBindings: ['atlassian-jira'],
    framework: 'operations-dependency-sequencing',
    outputContract: 'operations-triage',
    proposalAuthority: 'propose-only',
    runtime: 'none',
  },
  ...overrides,
});

test('embed block uses Worker Profile vocabulary and validates strictly', () => {
  assert.deepEqual(validateEmbedBlock(record(), { knownWorkerProfiles: ['operations'] }), { valid: true });
  const unknown = record();
  unknown.embed.workerProfileId = 'unknown';
  const result = validateEmbedBlock(unknown, { knownWorkerProfiles: ['operations'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("unknown Worker Profile 'unknown'")));
});

test('canonical built-ins supply all embedded Procedures', () => {
  const { capabilities, errors } = loadEmbedCapabilities({ packRoots: [] });
  assert.deepEqual(errors, []);
  assert.deepEqual(capabilities.map((entry) => entry.id).sort(), ['operations', 'operations-triage', 'pm-feedback', 'pm-repos']);
  assert.ok(capabilities.every((entry) => entry._filePath.includes('registry/procedures')));
});

test('project extensions live only under .construct/procedures', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-embed-procedure-'));
  try {
    assert.match(embedProjectDir(root), /\.construct\/procedures$/);
    mkdirSync(embedProjectDir(root), { recursive: true });
    writeFileSync(join(embedProjectDir(root), 'sample-embed.json'), JSON.stringify(record()));
    const { capabilities, errors } = loadEmbedCapabilities({ rootDir: root, packRoots: [] });
    assert.deepEqual(errors, []);
    assert.ok(capabilities.some((entry) => entry.id === 'sample-embed'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('enable and disable operate on canonical project Procedure records', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-embed-enable-'));
  try {
    const enabled = enableCapability('operations', { rootDir: root, overrides: { embed: { runtime: 'none' } }, packRoots: [] });
    assert.equal(enabled.ok, true);
    assert.ok(listCapabilities({ rootDir: root, packRoots: [] }).capabilities.find((entry) => entry.id === 'operations').enabled);
    assert.equal(disableCapability('operations', { rootDir: root }).disabled, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
