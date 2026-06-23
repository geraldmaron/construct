/**
 * tests/e2e/artifact-quality.test.mjs — guards the Layer-4 artifact-quality
 * validator (lib/artifact-quality.mjs) with a good and a bad PRD fixture, so the
 * gate that judges real-LLM artifacts is itself proven before it judges anything.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assessArtifactQuality } from './lib/artifact-quality.mjs';

// A PRD with every required section, real multi-sentence paragraphs, and two
// dated primary-source citations — the shape the specialist chain should produce.
const GOOD_PRD = `# PRD: Multi-tenant billing

## Problem

Tenants currently share a single billing ledger, so a usage spike in one tenant
distorts every tenant's invoice. The coupling makes per-tenant reconciliation
impossible and blocks the enterprise contracts that require isolated billing.

## Goals

Isolate billing state per tenant and make reconciliation a per-tenant operation.
Each tenant's invoice must be derivable from that tenant's events alone, with no
cross-tenant read. The change should not regress single-tenant performance.

## Success metrics

Per-tenant reconciliation completes without reading another tenant's data, and
invoice generation latency stays within the current p95. Adoption is measured by
the number of tenants migrated off the shared ledger over two release cycles.

| Metric | Baseline | Target |
|---|---|---|
| Reconciliation isolation | shared ledger | per-tenant |
| Invoice p95 latency | 420ms | ≤450ms |

## User flow

\`\`\`mermaid
flowchart LR
  A[Usage event] --> B[Tenant ledger]
  B --> C[Invoice]
\`\`\`

## Risks and mitigations

The migration could double-bill during cutover; a dry-run reconciliation gates
each tenant before the switch. Evidence for the isolation approach draws on
https://martinfowler.com/articles/patterns-of-distributed-systems/ (accessed 2026-06-07)
and the event-sourcing analysis at https://arxiv.org/abs/2010.12345 (accessed 2026-06-07).
`;

// A flat outline: bullet-only, no prose, no sources — the "flat PRD, no research"
// failure the gate must catch.
const BAD_PRD = `# PRD: Billing

## Problem
- billing is shared

## Goals
- isolate it

## Success metrics
- it works

## Risks and mitigations
- could break
`;

test('the quality gate passes a well-formed, sourced, prose PRD', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-good-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, 'prd.md');
  writeFileSync(p, GOOD_PRD);
  const v = assessArtifactQuality(p, 'prd');
  assert.ok(v.structure.ok, `structure: ${JSON.stringify(v.structure.errors)}`);
  assert.ok(v.prose.ok, `prose paragraphs ${v.prose.paragraphs} < ${v.prose.min}`);
  assert.ok(v.research.ok, `citations ${v.research.citations}`);
  assert.ok(v.ok, 'overall pass');
});

test('the quality gate fails a bullet-only PRD with no research', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aq-bad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = join(dir, 'prd.md');
  writeFileSync(p, BAD_PRD);
  const v = assessArtifactQuality(p, 'prd');
  assert.ok(!v.prose.ok, 'bullet-only must fail the prose check');
  assert.ok(!v.research.ok, 'no sources must fail the research check');
  assert.ok(!v.ok, 'overall fail');
});
