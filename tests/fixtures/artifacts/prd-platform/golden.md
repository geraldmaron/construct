---
description: Golden prd-platform fixture for artifact release-gate certification tests.
cx_fixture_type: prd-platform
cx_fixture_source: templates/docs/prd-platform.md
---

# Golden fixture: prd-platform

## TL;DR

This paragraph supports the TL;DR section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the TL;DR section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the TL;DR section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22).

## Background

This paragraph supports the Background section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the Background section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the Background section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22).

## Problem

This paragraph supports the Problem section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the Problem section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22). This paragraph supports the Problem section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22).

## Outcomes - Goals & Non-Goals

Fixture content for Outcomes - Goals & Non-Goals.

## Why This Matters Now

Timing thesis with financially meaningful pressure.

| Timing dimension | Estimate / window | Source |
|---|---|---|
| Revenue at risk | unknown | [unverified] — owner: pm by 2026-08-15 |
| Upside / opportunity window | unknown | [unverified] |
| Market timing | unknown | [unverified] |
| Cost of delay | support toil compounds | playbook |
| Competitive window | unknown | see Competitive |
| Compliance / legal deadline | PII on share grant | privacy |


## Competitive Landscape & Financial Considerations

### Competitive landscape

Prose on alternatives, then a small matrix.

| Competitor / alternative | Dimension | Their approach | Our stance | Source |
|---|---|---|---|---|
| Email | workflow | forks | differentiate | observed |

### Financial considerations

One short paragraph on structural economics.

| Item | Low | Base | High | Source |
|---|---|---|---|---|
| Build / run cost | unknown | unknown | unknown | [unverified] — owner: eng by 2026-08-15 |
| Unit economics | unknown | unknown | unknown | [unverified] |
| Expected value / ROI | unknown | unknown | unknown | [unverified] |

## Phases

### Phase 1: Fixture delivery

- **Why?**: Tenant billing owners need isolated ledgers so reconciliation stops cross-reading neighbor data.
- **Goal**: Ship an isolated billing ledger per tenant.
- **Status**: not started
- **Requirements**: FR-1.1


## Requirements

### Phase 1 — Fixture delivery

**Why?** Billing operators need per-tenant isolation so invoices derive from one ledger.

#### FR-1.1: Isolate tenant ledger

Each tenant invoice derives only from that tenant ledger events.

- **Phase**: 1
- **Acceptance criteria**: AC-1.1.1


## Acceptance Criteria

| AC id | FR id | Criterion (stranger-checkable) | Verification method |
|---|---|---|---|
| AC-1.1.1 | FR-1.1 | Reconciliation test passes without cross-tenant reads | automated |


## Success Metrics

Fixture content for Success Metrics.

## Risks

Fixture content for Risks.

## References

Fixture content for References.

```mermaid
flowchart LR
  A[Start] --> B[End]
```

| Metric | Type | Baseline | Target | Owner | Source |
| --- | --- | --- | --- | --- | --- |
| Metric value | Type value | Baseline value | Target value | Owner value | Source value |

| AC id | FR id | Criterion (stranger-checkable) | Verification method |
| --- | --- | --- | --- |
| AC id value | FR id value | Criterion (stranger-checkable) value | Verification method value |
