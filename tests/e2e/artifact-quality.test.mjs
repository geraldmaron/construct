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
import { assessArtifactQuality } from '../../lib/artifact-quality.mjs';

// A PRD with every required section, real multi-sentence paragraphs, and two
// dated primary-source citations — the shape the specialist chain should produce.
const GOOD_PRD = `# PRD: Multi-tenant billing

## TL;DR

Enterprise tenants need billing isolation before the next contract renewal window closes. This PRD scopes per-tenant ledgers, reconciliation APIs, and a phased migration so invoices derive from one tenant's events alone. Done means reconciliation passes without cross-tenant reads and invoice latency stays within the current p95.

## Background

Tenants currently share a single billing ledger, so usage spikes in one tenant distort every invoice. Prior architecture reviews flagged the coupling as a blocker for enterprise contracts requiring isolated billing.

| Evidence | What it shows | Link / id |
|---|---|---|
| Distributed systems patterns | Event isolation patterns | [Martin Fowler patterns](https://martinfowler.com/articles/patterns-of-distributed-systems/) (accessed 2026-06-07) |
| Event sourcing survey | Audit-friendly ledgers | [arXiv survey](https://arxiv.org/abs/2010.12345) (accessed 2026-06-07) |

## Problem

Tenants currently share a single billing ledger, so a usage spike in one tenant
distorts every tenant's invoice. The coupling makes per-tenant reconciliation
impossible and blocks the enterprise contracts that require isolated billing.

## Outcomes - Goals & Non-Goals

**Goals:**

1. Isolate billing state per tenant and make reconciliation a per-tenant operation.
2. Keep invoice generation latency within the current p95 during migration.

**Non-goals:**

- Replacing the payment processor: out of scope for this phase.
- Multi-region ledger replication: deferred until isolation is proven.

## Why This Matters Now

Renewal negotiations start in two quarters; shared-ledger customers cannot sign isolation clauses until reconciliation is per-tenant.

| Timing dimension | Estimate / window | Source |
|---|---|---|
| Revenue at risk | unknown | [unverified] — owner: pm by 2026-08-15 |
| Upside / opportunity window | Q3 enterprise renewals | sales pipeline |
| Market timing | competitors ship tenant isolation | [unverified] |
| Cost of delay | support toil compounds | playbook |
| Competitive window | unknown | see Competitive |
| Compliance / legal deadline | SOC2 isolation clause | compliance |

## Competitive Landscape & Financial Considerations

### Competitive landscape

Competitors offer per-tenant billing as a premium tier; we match on isolation but differentiate on reconciliation APIs.

| Competitor / alternative | Dimension | Their approach | Our stance | Source |
|---|---|---|---|---|
| Shared ledger (status quo) | isolation | none | replace | observed |

### Financial considerations

| Item | Low | Base | High | Source |
|---|---|---|---|---|
| Build / run cost | unknown | unknown | unknown | [unverified] — owner: eng by 2026-08-15 |
| Unit economics | unknown | unknown | unknown | [unverified] |
| Expected value / ROI | unknown | unknown | unknown | [unverified] |

## Phases

| Phase | Name | Why? (human purpose) | Ships when | Status |
|---|---|---|---|---|
| 1 | Shadow ledger | Prove reconciliation parity before cutover | ACs green | not started |
| 2 | Tenant migration | Move eligible tenants with rollback | Phase 1 exit | not started |

## Requirements

### Phase 1 — Shadow ledger

**Why?** Billing operators need per-tenant isolation so invoices derive from one ledger without cross-tenant reads.

#### FR-1.1: Tenant-scoped ledger writes

The billing service must write tenant-scoped ledger entries and expose a
reconciliation API that rejects cross-tenant reads by construction.

- **Phase**: 1
- **Acceptance criteria**: AC-1.1.1, AC-1.1.2

## Acceptance Criteria

| AC id | FR id | Criterion (stranger-checkable) | Verification method |
|---|---|---|---|
| AC-1.1.1 | FR-1.1 | Given a tenant-scoped reconciliation request, the job reads only that tenant's ledger | automated |
| AC-1.1.2 | FR-1.1 | Given a cutover dry run, any double-bill delta blocks migration for that tenant | automated |

## Success Metrics

Per-tenant reconciliation completes without reading another tenant's data, and
invoice generation latency stays within the current p95. Adoption is measured by
the number of tenants migrated off the shared ledger over two release cycles.

| Metric | Type | Baseline | Target | Owner | Source |
|---|---|---|---|---|---|
| Reconciliation isolation | lagging | shared ledger | per-tenant | pm | this PRD |
| Invoice p95 latency | leading | 420ms | ≤450ms | eng | [unverified] |

## Risks

The migration could double-bill during cutover; a dry-run reconciliation gates
each tenant before the switch. Evidence for the isolation approach draws on
[Martin Fowler patterns](https://martinfowler.com/articles/patterns-of-distributed-systems/) (accessed 2026-06-07)
and the [arXiv event-sourcing survey](https://arxiv.org/abs/2010.12345) (accessed 2026-06-07).

## References

- [Martin Fowler — Patterns of Distributed Systems](https://martinfowler.com/articles/patterns-of-distributed-systems/) (accessed 2026-06-07)
- [arXiv event-sourcing survey](https://arxiv.org/abs/2010.12345) (accessed 2026-06-07)

\`\`\`mermaid
flowchart LR
  A[Usage event] --> B[Tenant ledger]
  B --> C[Invoice]
\`\`\`
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
