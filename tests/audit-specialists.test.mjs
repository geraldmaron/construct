/**
 * tests/audit-specialists.test.mjs — specialist corpus audit matrix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSpecialists } from '../lib/audit-specialists.mjs';

test('auditSpecialists covers all registry specialists', () => {
  const r = auditSpecialists({ silent: true });
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.equal(r.specialistCount, 12);
  assert.ok(r.specialists.every((s) => s.humanEquivalent && s.grade));
});

test('auditSpecialists cross-checks docArtifacts against manifest', () => {
  const r = auditSpecialists({ silent: true });
  const docIssues = r.crossCheckIssues.filter((i) => i.kind === 'doc-artifact-no-manifest');
  assert.deepEqual(docIssues, []);
});

test('construct audit specialists CLI emits JSON', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('node', ['bin/construct', 'audit', 'specialists', '--json'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.ok(parsed.specialists.length >= 12);
});
