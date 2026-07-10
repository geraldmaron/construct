/**
 * tests/functional/artifact-release-gate.functional.test.mjs — end-to-end artifact gate in tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifactRelease } from '../../lib/artifact-release-gate.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

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
    rmTmpDir(dir);
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
    rmTmpDir(dir);
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

[source: docs/decisions/adr/prior-art.md]
`,
    );
    const r = validateArtifactRelease({ filePath: f, type: 'adr', rootDir: REPO, cwd: dir });
    assert.equal(r.ok, true, r.errors.join('; '));
  } finally {
    rmTmpDir(dir);
  }
});

// Reviewer sign-off gating (construct-pteo2.13): advisory default warns;
// enforced blocks only when the enforcementScope team holds the decisionRight.

const PASSING_PRD_BODY = `# PRD: Search improvements

## Problem

Search relevance degrades on long-tail queries and support tickets cite it weekly. The current ranking treats all fields equally, so title matches drown out body relevance for detailed questions. [unverified]

Users who fail a search retry with shorter queries, which compounds the relevance problem and hides the real intent from analytics. [unverified]

## Proposal

Introduce field-weighted ranking with a relevance-tuned analyzer, rolled out behind a feature flag to a beta cohort first. Measurement precedes expansion. [unverified]

## Success metrics

Long-tail click-through rises measurably against the pre-launch baseline before full rollout; zero regression on head queries. [unverified]

## Rollout

| Stage | Cohort |
|---|---|
| 1 | beta |
| 2 | all |

Rollout proceeds stage by stage with a rollback lever at each stage. [unverified]
`;

function writeOverlay(dir, reviewerGate) {
  const cx = join(dir, '.cx');
  fsMkdir(cx);
  writeFileSync(join(cx, 'artifact-manifest.overlay.json'), JSON.stringify({
    artifacts: { prd: { releaseGate: { reviewerGate } } },
  }));
}

function fsMkdir(p) {
  mkdirSync(p, { recursive: true });
}

test('reviewer gate default is advisory: missing sign-off warns, never blocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-reviewer-advisory-'));
  try {
    const f = join(dir, 'prd.md');
    writeFileSync(f, PASSING_PRD_BODY);
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir, reviewersSeen: new Set() });
    assert.equal(r.reviewerGate.mode, 'advisory');
    assert.equal(r.reviewerGate.blocked, false);
    assert.ok(r.reviewerGate.missing.length > 0, 'reviewers are missing');
    assert.ok(r.warnings.some((w) => w.includes('requiredReviewers not seen')), 'warns');
    assert.ok(!r.errors.some((e) => e.includes('requiredReviewers')), 'never an error by default');
  } finally {
    rmTmpDir(dir);
  }
});

test('enforced gate with an authorized team blocks a missing sign-off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-reviewer-enforced-'));
  try {
    writeOverlay(dir, { mode: 'enforced', enforcementScope: { team: 'quality-team', decisionRight: 'quality-gate-approval' } });
    const f = join(dir, 'prd.md');
    writeFileSync(f, PASSING_PRD_BODY);
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir, reviewersSeen: new Set() });
    assert.equal(r.reviewerGate.mode, 'enforced');
    assert.equal(r.reviewerGate.blocked, true);
    assert.equal(r.ok, false, 'gate fails');
    assert.ok(r.errors.some((e) => e.includes('requiredReviewers not seen') && e.includes('quality-team')));

    const seen = new Set(['cx-reviewer', 'cx-architect', 'cx-product-manager', 'cx-security']);
    const pass = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir, reviewersSeen: seen });
    assert.equal(pass.reviewerGate.blocked, false, 'sign-offs present clears the enforced gate');
  } finally {
    rmTmpDir(dir);
  }
});

test('enforced gate cannot block when the team lacks the decisionRight or forbids it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-reviewer-unauthorized-'));
  try {
    writeOverlay(dir, { mode: 'enforced', enforcementScope: { team: 'design-team', decisionRight: 'quality-gate-approval' } });
    const f = join(dir, 'prd.md');
    writeFileSync(f, PASSING_PRD_BODY);
    const r = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir, reviewersSeen: new Set() });
    assert.equal(r.reviewerGate.blocked, false, 'team without the right cannot block');
    assert.match(r.reviewerGate.reason, /does not hold decisionRight/);

    writeOverlay(dir, { mode: 'enforced', enforcementScope: { team: 'quality-team', decisionRight: 'scope-change' } });
    const forbidden = validateArtifactRelease({ filePath: f, type: 'prd', rootDir: REPO, cwd: dir, reviewersSeen: new Set() });
    assert.equal(forbidden.reviewerGate.blocked, false, 'forbiddenDecisions wins');
    assert.match(forbidden.reviewerGate.reason, /forbids decision/);
  } finally {
    rmTmpDir(dir);
  }
});

test('recruited reviewers join the required set and the CLI exits 2 on an enforced block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-gate-reviewer-recruited-'));
  try {
    writeOverlay(dir, { mode: 'enforced', enforcementScope: { team: 'quality-team', decisionRight: 'quality-gate-approval' } });
    const f = join(dir, 'prd.md');
    writeFileSync(f, PASSING_PRD_BODY);

    const seen = new Set(['cx-reviewer', 'cx-architect', 'cx-product-manager', 'cx-security']);
    const r = validateArtifactRelease({
      filePath: f, type: 'prd', rootDir: REPO, cwd: dir,
      reviewersSeen: seen, recruitedReviewers: ['cx-data-analyst'],
    });
    assert.deepEqual(r.reviewerGate.missing, ['cx-data-analyst'], 'recruited reviewer counted as required');
    assert.equal(r.reviewerGate.blocked, true);

    const cli = spawnSync(process.execPath, [join(REPO, 'bin', 'construct'), 'artifact', 'validate', f, '--type=prd', '--recruited=cx-data-analyst', '--json'], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(cli.status, 2, `enforced reviewer block exits 2; stdout: ${cli.stdout.slice(0, 400)}`);
  } finally {
    rmTmpDir(dir);
  }
});
