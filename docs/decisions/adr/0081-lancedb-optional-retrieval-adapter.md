<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0081: LanceDB is an optional retrieval adapter, not a required core dependency

- **Date**: 2026-07-18
- **Status**: accepted
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none
- **Relates to**: amends `docs/decisions/adr/0001-zero-npm-core.md`'s LanceDB/apache-arrow exception (see that ADR's status update note) without superseding it wholesale — its `@modelcontextprotocol/sdk`/`js-yaml` exceptions stand; `lib/storage/retrieval-adapter.mjs` (the contract this ADR introduces), `lib/storage/vector-client.mjs` (the LanceDB adapter), `lib/storage/adapters/keyword-adapter.mjs` (the no-vector fallback), `docs/notes/research/workspace-control-plane/synthesis/disposition-matrix.md` Cluster D6s, bead `construct-b0nny.20`

<!-- Owning specialist: cx-architect. -->

## Problem

ADR-0001 declared `@lancedb/lancedb` and `apache-arrow` as sanctioned core `dependencies`, accepted because they provided "essential vector performance with no viable built-in alternative." Every `npm install` of the published CLI therefore pulled a native vector database and its Arrow serialization layer, whether or not the installing project ever used semantic memory search. The workspace-control-plane program's directive §13 requires core to run with no required vector database; disposition-matrix.md Cluster D6s calls this out explicitly: "a required LanceDB dependency in core contradicts the sustainability constraints."

`lib/observation-store.mjs`'s `searchObservations()` already documented the gap in its own comment: a failed vector search "return[s] empty since fallback is removed" — there was no no-vector retrieval path for the observation/entity memory store (D4s), even though `lib/knowledge/rag.mjs` and `lib/knowledge/search.mjs` already ran a fully dependency-free BM25 + hashing-embedding retrieval path for the separate knowledge/RAG surface (D5s). Two parallel retrieval mechanisms existed, only one of which worked without LanceDB.

## Decision

`lib/storage/retrieval-adapter.mjs` defines a retrieval-adapter contract (`isHealthy`, `storeObservation`/`searchObservations`, `storeDocument`/`searchDocuments`, `pruneObservations`, `close`) that any memory storage backend can implement. Two adapters implement it:

- **LanceDB adapter** (`lib/storage/vector-client.mjs`, unchanged behavior) — semantic/vector search, selected when `@lancedb/lancedb` + `apache-arrow` load and connect successfully.
- **Keyword/BM25 adapter** (`lib/storage/adapters/keyword-adapter.mjs`, new) — zero-dependency, reuses the same `rankByBm25` scorer `lib/knowledge/rag.mjs`/`lib/knowledge/search.mjs` already rely on, persisting its own derived index under the project's machine-scoped state root.

Selection (`createRetrievalAdapter()`) defaults to `auto`: try LanceDB, fall back to keyword on any load/health failure, with one stderr notice per process. `CONSTRUCT_RETRIEVAL_ADAPTER=lancedb|keyword` pins the choice explicitly.

`@lancedb/lancedb` and `apache-arrow` move from `dependencies` to `optionalDependencies` in `package.json` (`tests/core-dependency-policy.test.mjs` enforces this, mirroring ADR-0014's precedent for the local-embedding ML stack). The observation/entity domain model (`lib/observation-store.mjs`'s per-record JSON files) is unaffected — only the derived search index behind it is now adapter-swappable. `scripts/reindex-retrieval-adapter.mjs` rebuilds either adapter's index from that durable JSON source, so switching adapters (or recovering a corrupted index) never loses data.

## Rationale

The knowledge/RAG surface already proved a pure-JS BM25 retrieval path is viable in this codebase at production quality; extending the same scorer to the observation/entity store closes the one remaining hard dependency on a native vector database without inventing new retrieval technology. Making LanceDB optional rather than removing it preserves semantic-quality search for installs that can and want to pull the native binary, while installs in locked-down, air-gapped, or unsupported-platform environments still get a fully functional memory system.

## Rejected alternatives

- **Keep LanceDB required, document the constraint as accepted risk.** Directive §13 is explicit that no required vector database is acceptable; rejected as non-compliant with the program's own standard.
- **Remove LanceDB entirely, keyword-only.** Loses semantic-quality retrieval for every installer, including ones with no reachability constraint. Rejected as a capability regression when an adapter seam preserves both goals (mirrors ADR-0014's rejection of removing local embeddings entirely).
- **Route observation search through `lib/knowledge/rag.mjs`'s existing BM25 path instead of a new adapter.** That path indexes markdown/artifact chunks with a different chunking and corpus-assembly model (heading-aware chunking, RRF+MMR reranking) built for docs/knowledge retrieval, not observation rows with role/category/project filters. Reusing its scorer (`rankByBm25`) without forcing observation-store through its corpus/reranking pipeline keeps the two retrieval surfaces' reconciliation (disposition-matrix.md D7) a separate, later decision.

## Consequences

- Default installs no longer require a native vector database binary to succeed; `npm install --omit=optional` produces a fully functional (keyword-only) install.
- An operator who wants semantic search either accepts the default optional install (npm installs optional deps by default) or explicitly forces `CONSTRUCT_RETRIEVAL_ADAPTER=lancedb`.
- `tests/core-dependency-policy.test.mjs` enforces that `@lancedb/lancedb`/`apache-arrow` stay out of runtime `dependencies`.
- Status/doctor surfaces (`lib/status.mjs`'s `probeStorageHealth`, `lib/storage/admin.mjs`'s `getStorageStatus`) report `backend: 'keyword'` only when `CONSTRUCT_RETRIEVAL_ADAPTER=keyword` is set explicitly; a silent `auto` fallback (LanceDB installed but unreachable at runtime) still reports the LanceDB-path probe, tracked as a follow-up rather than blocking this ADR.

## Reversibility

Two-way door. LanceDB remains a fully supported, first-class adapter — pinning `CONSTRUCT_RETRIEVAL_ADAPTER=lancedb` and installing the optional dependency restores the exact prior behavior. Promoting either package back to a required `dependency` is a one-line manifest change but would need a superseding ADR justifying the reintroduced supply-chain/install-reliability cost under ADR-0001.

## References

- [ADR-0001: Zero npm dependencies in core](0001-zero-npm-core.md)
- [ADR-0014: Local ONNX embeddings are an optional capability, not a core dependency](0014-local-embeddings-optional.md)
- `docs/notes/research/workspace-control-plane/synthesis/disposition-matrix.md` Cluster D6s
- `lib/storage/retrieval-adapter.mjs`, `lib/storage/adapters/keyword-adapter.mjs`, `lib/storage/vector-client.mjs`, `scripts/reindex-retrieval-adapter.mjs`
