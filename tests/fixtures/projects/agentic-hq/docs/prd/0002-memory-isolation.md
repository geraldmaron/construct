---
title: Cross-tenant memory isolation
status: draft
owner: cx-product-manager
created: 2026-05-08
intake_id: null
intake: none
intake_rationale: Authored before intake provenance was introduced
---

# PRD-0002: Cross-tenant memory isolation

## Problem

Memory layer currently uses a single Postgres database with `tenant_id` column filtering. Two issues observed:

1. **Single-DB blast radius.** A bad query at the SQL layer can return cross-tenant rows. Verified in `security-scan-finding-2026-05-15` (test scan): a missing `WHERE tenant_id = $1` clause exposed 14 rows from 3 tenants.
2. **Vector recall leakage.** pgvector similarity search doesn't enforce tenant scope at the index level; if the application layer forgets the filter, top-k returns cross-tenant matches.

## Goal

Hard isolation at the storage layer, not just the application layer. Application-layer forgetting must not leak data.

## Approach options

Three options under review:

### Option A: schema-per-tenant

Each tenant gets a Postgres schema (`tenant_<uuid>`). Application connects with a role scoped to that schema. SQL injection at the app layer can't reach another tenant's schema.

### Option B: database-per-tenant (medium tenants and up)

Free tier remains shared schema; team/enterprise get their own database. Reduces query-layer risk for the paying customers who carry compliance concerns.

### Option C: row-level security (RLS)

Postgres RLS policies enforce `tenant_id = current_setting('app.current_tenant')`. App still uses a single schema; database refuses to return rows the session token doesn't authorize.

## Open questions

- Which option does cx-security prefer? Pending review.
- Cost impact of B at our current tenant count (`unknown` — we have ~840 tenants total; database-per-tenant for team+enterprise tier means ~120 new databases. Per-database overhead `[unverified]`).
- Migration path for existing data without downtime: not yet designed.

## Success criteria

- A SQL injection in any query layer cannot return another tenant's data. Verified by red-team test.
- pgvector top-k cannot return cross-tenant matches even with no `WHERE` clause.
- No regression on cold-start query latency (current p95: 87ms per `eval-q1-memory-latency`).

## Sources

- `security-scan-finding-2026-05-15.json` (test scan, in `.cx/intake/processed/`)
- ADR-0002 (embedding model choice — affects index implementation)
