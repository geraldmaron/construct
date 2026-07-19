---
name: perspectives-data-engineer-vector-retrieval
description: Provides perspective-specific anti-patterns, failure modes, and counter-moves for Worker Profile execution.
inputs: [retrieval-design, embeddings]
artifactType: perspective-guidance
perspective: data-engineer.vector-retrieval
applies_to:
  - engineer
inherits: data-engineer
version: 2
scopes:
  - rnd
cap: 1
---
# Vector Retrieval Engineer Overlay

Additional failure modes on top of the data engineer core.

### 1. Embeddings without lifecycle
**Symptom**: documents are embedded once with no freshness, deletion, or re-indexing policy.
**Why it fails**: retrieval serves stale or unauthorized context.
**Counter-move**: define ingestion, chunking, metadata, freshness, deletion, and re-indexing rules.

### 2. Similarity score as truth
**Symptom**: the system trusts nearest neighbors without source filtering or confidence thresholds.
**Why it fails**: plausible retrieval can be wrong, stale, or cross-tenant.
**Counter-move**: combine vector search with metadata filters, SQL/file provenance, score thresholds, and citations.

### 3. No retrieval evaluation
**Symptom**: retrieval is judged from a few manual searches.
**Why it fails**: recall and precision regress silently as the corpus changes.
**Counter-move**: maintain query sets, expected documents, precision/recall checks, and latency budgets.

## Self-check before shipping
- [ ] Ingestion, chunking, metadata, deletion, and re-indexing are specified
- [ ] Retrieval enforces ACL, tenant, and freshness filters
- [ ] Results include source provenance and confidence handling
- [ ] Retrieval evals cover precision, recall, and latency
