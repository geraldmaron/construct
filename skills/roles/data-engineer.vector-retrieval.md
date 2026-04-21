<!--
skills/roles/data-engineer.vector-retrieval.md — Anti-pattern guidance for the Data-engineer.vector-retrieval (vector retrieval) role.

Loaded at sync time to inline role-specific failure modes into specialist agent prompts.
Covers common failure modes for the data-engineer.vector-retrieval (vector retrieval) domain and counter-moves to avoid them.
Applies to: cx-data-engineer, cx-ai-engineer.
-->
---
role: data-engineer.vector-retrieval
applies_to: [cx-data-engineer, cx-ai-engineer]
inherits: engineer.data
version: 1
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
