/**
 * oracle-alignment-regression.test.mjs — pins cleared alignment ratchet regressions
 * for construct-4b2bw and duplicate oracle beads on feat/workspace-control-plane.
 *
 * Verifies deadcode allowlist entries and docs nav wiring stay off the finding set.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { docsFindings } from '../../scripts/audit/03-docs.mjs';
import { brandFindings } from '../../scripts/audit/03d-brand.mjs';
import { deadcodeFindings } from '../../scripts/audit/02-deadcode.mjs';
import { makeId } from '../../scripts/audit/lib/findings.mjs';
import baseline from '../../scripts/audit/baseline.json' with { type: 'json' };

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const CLEARED_DEADCODE_IDS = [
  '02-deadcode:module-test-only:lib/certification/host-adapter-certification.mjs',
  '02-deadcode:module-test-only:lib/certification/richdocument-production.mjs',
  '02-deadcode:module-test-only:lib/export/html-provider.mjs',
  '02-deadcode:module-test-only:lib/orchestration/guidance-capability-drift.mjs',
];

const CLEARED_DOC_IDS = [
  '03-docs:orphaned-doc:docs/decisions/adr/0095-certified-prompt-versions.md',
  '03-docs:orphaned-doc:docs/guides/reference/html-export-sanitization.md',
  '03-docs:orphaned-doc:docs/operations/runbooks/orchestration-startup-to-invocation.md',
  '03-docs:review-doc-reference:registry',
];

const CLEARED_BRAND_PREFIX = '03d-brand:brand-construct-naming:docs/guides/reference/cli/command-catalog.md_';

test('oracle alignment regressions stay cleared in deadcode audit', () => {
  const current = deadcodeFindings().map((r) => makeId('02-deadcode', r.type, r.target));
  for (const id of CLEARED_DEADCODE_IDS) {
    assert.ok(!current.includes(id), `${id} must not regress`);
  }
});

test('oracle alignment regressions stay cleared in docs audit', () => {
  const current = docsFindings().map((r) => makeId('03-docs', r.type, r.target));
  for (const id of CLEARED_DOC_IDS) {
    assert.ok(!current.includes(id), `${id} must not regress`);
  }
});

test('command catalog brand regressions stay cleared', () => {
  const current = brandFindings()
    .map((r) => makeId('03d-brand', r.type, r.target))
    .filter((id) => id.startsWith(CLEARED_BRAND_PREFIX));
  assert.equal(current.length, 0, `unexpected brand regressions: ${current.join(', ')}`);
});

test('alignment census ratchet has zero regressions', () => {
  const censusPath = path.join(REPO, 'audit-artifacts', 'alignment-census.json');
  assert.ok(fs.existsSync(censusPath), 'run node scripts/alignment/census.mjs before this test in CI');
  const census = JSON.parse(fs.readFileSync(censusPath, 'utf8'));
  const regressions = census.audit?.ratchet?.regressions ?? [];
  const unexpected = regressions.filter((id) => !baseline.acceptedIds.includes(id));
  assert.equal(unexpected.length, 0, `ratchet regressions: ${unexpected.join(', ')}`);
});
