/**
 * tests/functional/artifact-release-gate.functional.test.mjs — end-to-end artifact gate in tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifactRelease } from '../../lib/artifact-release-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('artifact gate blocks PRD missing required sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-'));
  try {
    const f = join(dir, 'bad-prd.md');
    writeFileSync(f, '# PRD\n\n## Problem\n\nOnly one section.\n');
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artifact gate accepts bypass with documented reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-bypass-'));
  try {
    const f = join(dir, 'draft-prd.md');
    writeFileSync(
      f,
      '---\ncx_release_gate: bypass\ncx_release_gate_reason: executive draft review only\n---\n\n# PRD\n',
    );
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir });
    assert.equal(r.ok, true);
    assert.equal(r.bypassed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('artifact gate accepts ADR with context diagram and required sections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-adr-'));
  try {
    const f = join(dir, 'adr.md');
    writeFileSync(
      f,
      `# ADR-001: Event sourcing for audit log

## Problem

The audit trail is append-only today but readers cannot reconstruct state at a point in time. Operators need a durable log that replays into current projections without losing ordering guarantees.

Downstream analytics also assumes mutable rows, which forces expensive full-table scans when reconciling incidents. That cost grows linearly with retention and blocks near-real-time dashboards.

## Context

\`\`\`mermaid
flowchart LR
  A[Current state] --> B[Decision]
  B --> C[Target state]
  D[Rejected alt] -.-> B
\`\`\`

## Decision

Adopt event sourcing for the audit log with a single writer per aggregate.

## Rejected alternatives

Keeping the mutable row model was rejected because backfills corrupt historical reads.

## Consequences

Replay tooling becomes mandatory; migrations must be versioned.

## Reversibility

Reversible within one quarter if projection lag exceeds SLO.

[source: docs/adr/prior-art.md]
`,
    );
    const r = validateArtifactRelease({ filePath: f, type: 'adr', rootDir: REPO, cwd: dir });
    assert.equal(r.ok, true, r.errors.join('; '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
