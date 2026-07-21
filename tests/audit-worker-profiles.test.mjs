/**
 * Canonical Worker Profile and skill audit matrix.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditWorkerProfiles } from '../lib/audit-worker-profiles.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

test('auditWorkerProfiles covers the canonical Worker Profile registry', () => {
  const result = auditWorkerProfiles({ silent: true });
  assert.equal(result.workerProfileCount, 12);
  assert.equal(result.workerProfiles.length, 12);
  assert.ok(result.workerProfiles.every((profile) => profile.workerProfileId && profile.humanEquivalent));
  assert.ok(result.workerProfiles.every((profile) => Array.isArray(profile.skillEmphasis)));
  assert.equal('specialistCount' in result, false);
  assert.equal('specialists' in result, false);
});

test('auditWorkerProfiles cross-checks artifact classes against the manifest', () => {
  const result = auditWorkerProfiles({ silent: true });
  const artifactIssues = result.crossCheckIssues.filter((issue) => (
    issue.kind === 'artifact-class-no-manifest' || issue.kind === 'contract-artifact-no-manifest'
  ));
  assert.deepEqual(artifactIssues, []);
});

test('construct audit worker-profiles CLI emits canonical JSON', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(join(tmpdir(), 'audit-worker-profiles-home-'));
  t.after(() => rmTmpDir(home));
  const out = execFileSync('node', ['bin/construct', 'audit', 'worker-profiles', '--json'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CONSTRUCT_HOME_OVERRIDE: home },
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.workerProfiles.length, 12);
  assert.equal('specialists' in parsed, false);
});
