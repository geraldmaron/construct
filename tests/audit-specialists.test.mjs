/**
 * tests/audit-specialists.test.mjs — specialist corpus audit matrix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('construct audit specialists CLI emits JSON', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const home = mkdtempSync(join(tmpdir(), 'audit-specialists-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const out = execFileSync('node', ['bin/construct', 'audit', 'specialists', '--json'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CX_HOME_OVERRIDE: home },
  });
  const parsed = JSON.parse(out);
  // construct-rf26.11 consolidated the 29-specialist roster to 12 (orchestrator + 11 workers).
  assert.ok(parsed.specialists.length >= 12);
});
