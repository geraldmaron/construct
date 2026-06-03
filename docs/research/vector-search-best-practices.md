# Vector search & embedding reconciliation — best practices (2024–2026)

A cited research note grounding two architecture decisions in Construct's embedding/search layer.
Produced 2026-06-01 by a fan-out + adversarial-verification research pass (19 sources, 25 claims, each
confirmed by ≥2 of 3 independent verifiers; 0 refuted). Every load-bearing claim cites a primary source.

## Findings (verified)

1. **pgvector filters *after* the HNSW scan by default → "overfiltering."** A selective `WHERE` plus the
   default `hnsw.ef_search = 40` returns far fewer rows than the requested `LIMIT` (README example: a
   10%-selective filter yields ~4 rows), and the planner can flip to a sequential scan as `LIMIT`/
   selectivity change. Sources: [pgvector README](https://github.com/pgvector/pgvector);
   [Supabase HNSW docs](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes);
   [pgvector#721](https://github.com/pgvector/pgvector/issues/721);
   [AWS Aurora pgvector 0.8.0](https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql/).

2. **The native fix is pgvector 0.8.0 `hnsw.iterative_scan` (opt-in) + partial indexes** for
   few-distinct-value filters — not hand-rolled filter routing. `strict_order`/`relaxed_order`, bounded by
   `hnsw.max_scan_tuples` (20,000). Released 2024-10-30.
   Sources: pgvector README; [pgvector 0.8.0 release](https://www.postgresql.org/about/news/pgvector-080-released-2952/).

3. **One consolidated hybrid retrieval path, not multiple specialized ones.** Supabase = a single SQL
   function (full-text + vector CTEs merged); Pinecone = a single dense+sparse index ("simpler
   architecture, less operational overhead"). Sources: [Supabase hybrid-search](https://supabase.com/docs/guides/ai/hybrid-search);
   [Pinecone hybrid-search](https://docs.pinecone.io/guides/search/hybrid-search).

4. **Reciprocal Rank Fusion is the dominant fusion method** — `Σ 1/(k + rank)`, k≈60 (academic default;
   Supabase ships 50). Rank-only, so it merges BM25 (unbounded) and cosine ([-1,1]) without normalization
   or hand-tuned weights. Origin: Cormack, Clarke & Büttcher, SIGIR 2009.
   Sources: Supabase; [Weaviate fusion](https://weaviate.io/blog/hybrid-search-fusion-algorithms);
   [TigerData BM25+vector+RRF](https://www.tigerdata.com/blog/elasticsearchs-hybrid-search-now-in-postgres-bm25-vector-rrf).

5. **Reconciliation, not synchronous-inline-only.** pgvector has zero built-in sync; the recommended
   production pattern is async/queue-driven (Supabase triggers→pgmq→pg_cron→worker; Timescale `pgai`
   queue+workers), explicitly framed as drift prevention, complemented by idempotent backfill and
   model versioning. Sources: [Supabase automatic-embeddings](https://supabase.com/blog/automatic-embeddings);
   [timescale/pgai](https://github.com/timescale/pgai).

6. **Never mix incomparable embedding spaces; version embeddings with the model** (a dimension change is
   breaking/major); store new-model vectors separately for rollback. Partial re-embedding is *the* primary
   cause of drift — a mixed index "returns excellent results for recently reindexed documents and poor
   results for older ones, but nothing signals that two spaces are being compared." Sources:
   [Milvus versioning](https://milvus.io/ai-quick-reference/how-do-you-version-and-manage-changes-in-embedding-models);
   [TianPan 2026-04](https://tianpan.co/blog/2026-04-09-embedding-models-production-versioning-index-drift);
   [Qdrant migration](https://qdrant.tech/documentation/database-tutorials/migrate-to-a-new-embedding-model/).

## Decisions for Construct

**Reconciliation (implemented).** The canonical async/queue infrastructure (pgmq + pg_cron + workers) is
high-scale-service tooling, disproportionate for a solo-first tool that often runs without Postgres at
all. The principle is applied at proportionate weight: keep inline embedding on the happy path, and add an
**idempotent reconciliation pass keyed on `(content_hash, model)`** that re-embeds only rows that are
missing (pg was down at write) or stale (content edited, or model changed). See `lib/embed/reconcile.mjs`,
schema migration `db/schema/003_observation_reconciliation.sql`, and `construct storage reconcile`. The
pass is wired at storage touchpoints (the `construct embed` model-change re-embed; operator CLI), **not**
a fixed-interval cron — placement is the one part the research did not settle, so it is engineering
judgment.

**One search path with iterative_scan + RRF (foundation laid; consolidation staged).** The research is
decisive: collapse the two current document-search paths (`lib/storage/hybrid-query.mjs`'s naive pg scan
and the dormant `lib/knowledge/postgres-search.mjs` selectivity routing) into one path using pgvector
0.8's native `hnsw.iterative_scan` + RRF fusion — *not* the hand-rolled selectivity routing. The RRF
primitive is implemented and tested (`lib/storage/rrf.mjs`); the full single-path consolidation is the
next increment, contingent on pgvector ≥ 0.8.0 (the inflection point — below it only post-filtering
exists).

**Dual embedding spaces.** Construct's neural 384-dim pg space and the 256-dim local hashing fallback are
already kept in separate stores and never compared at query time — consistent with finding 6. The
reconciliation fingerprint now carries the `model`, so a model change re-embeds rather than silently
mixing spaces.

## Not settled by the research (engineering judgment)

- Reconciliation *placement* (sync-step/daemon vs cron) — chose sync/CLI touchpoints.
- The selectivity crossover for GIN pre-filter vs iterative_scan — defer to pgvector-native `iterative_scan`.
- RRF `k = 50 vs 60` — negligible at Construct's role-scoped corpus size (RRF is insensitive to k in 20–100).

## Caveat

Several reconciliation/versioning sources are vendor or vendor-adjacent (Supabase, Timescale, Pinecone,
Weaviate) and promote their own products; the load-bearing facts were corroborated by primary docs/repos,
but the "async is the recommended pattern" framing carries vendor positioning — hence the proportionate
(not literal) adoption above.
