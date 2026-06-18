/**
 * audit-ratchet.functional.test.mjs — permanent gate for the audit finder phases.
 *
 * Regenerates findings from the live codebase (smoke, docs, naming) and fails on any
 * finding whose id is absent from the committed baseline (scripts/audit/baseline.json).
 * A ratchet, not a wall: the existing backlog is grandfathered, so the gate blocks only
 * NEW drift — a fresh dead command, undocumented flag, orphaned doc, retired alias, or
 * naming divergence. Remediation removes ids from the baseline to tighten the ratchet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeId } from '../../scripts/audit/lib/findings.mjs';
import { smokeFindings } from '../../scripts/audit/01-smoke.mjs';
import { deadcodeFindings } from '../../scripts/audit/02-deadcode.mjs';
import { docsFindings } from '../../scripts/audit/03-docs.mjs';
import { namingFindings } from '../../scripts/audit/03b-naming.mjs';
import { auditFindings } from '../../scripts/audit/06-audit.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'audit', 'baseline.json'), 'utf8'));
const accepted = new Set(baseline.acceptedIds);

function idsFor(phase, rows) {
  return rows.map((r) => r.id || makeId(phase, r.type, r.target));
}

// 06-audit's chain-broken finding reflects the machine's ~/.cx trail, not the repo, so it
// is excluded from this repo gate (the dedicated chain functional tests cover it); only the
// repo-deterministic hook present/registered invariant is ratcheted here.

const repoDeterministic = (rows) => rows.filter((r) => r.type !== 'audit-chain-broken');

test('audit finders introduce no findings beyond the committed baseline', () => {
  const current = [
    ...idsFor('01-smoke', smokeFindings()),
    ...idsFor('02-deadcode', deadcodeFindings()),
    ...idsFor('03-docs', docsFindings()),
    ...idsFor('03b-naming', namingFindings()),
    ...idsFor('06-audit', repoDeterministic(auditFindings())),
  ];
  const regressions = current.filter((id) => !accepted.has(id));
  assert.deepEqual(
    regressions,
    [],
    `New audit finding(s) not in scripts/audit/baseline.json:\n  ${regressions.join('\n  ')}\n` +
    'Fix the drift, or (if intentional) add the id to the baseline.',
  );
});
