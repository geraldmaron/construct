---
title: Cohere embed-v3 over OpenAI text-embedding-3-large for memory recall
status: accepted
date: 2026-02-09
deciders: cx-architect, cx-ai-engineer
---

# ADR-0002: Cohere embed-v3 for memory recall

## Context

Need an embedding model for the per-tenant memory layer. Considered against the existing eval suite `memory-recall-q1-bench` (1,247 queries across 12 tenants).

## Decision

Cohere `embed-multilingual-v3.0` (1024-dim).

## Rejected alternatives

- **OpenAI `text-embedding-3-large` (3072-dim).** Best recall on the bench (mAP 0.847 vs Cohere 0.821), but per-dim storage cost is 3x. We accepted the recall difference for the cost win.
- **OpenAI `text-embedding-3-small` (1536-dim).** Comparable recall to Cohere (mAP 0.819) but no multilingual story; we have customers in 9 languages.
- **Voyage AI `voyage-3-large`.** Strong recall on English but `[unverified]` performance on non-English. Did not have enough eval coverage to pick over Cohere.
- **Self-hosted model (e.g., `bge-large`).** Quality-cost frontier acceptable but the operational cost of running our own inference at our scale exceeds savings. Revisit if request volume passes 50M/day.

## Consequences

- Storage at 1024-dim is workable for pgvector with our current sharding.
- Multilingual recall is now a first-class evaluation dimension. Bench is being expanded to cover Korean, Portuguese, Arabic.
- Cohere is now a vendor dependency. Outage = degraded memory. Fallback to OpenAI small is in `[unverified]` state — needs implementation work.

## What we do not know

- How embed-v4 (rumored Q3 2026) will compare. `unknown`. Plan to re-evaluate when it ships.

## Source

- Eval bench `memory-recall-q1-bench` (run id `eval-2026-02-04-mb-1247`)
- Vendor pricing pages as-of 2026-02-09 (snapshot in `.construct/knowledge/external/vendor-pricing-snapshot-2026-02.md`)
