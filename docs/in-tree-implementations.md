# In-Tree Implementations

This document inventories every hand-rolled component in Construct's core (`lib/`) that exists because of the zero-npm-dep policy for the core zone. For each component, it records: location, LOC, test coverage, known limitations, and the nearest library alternative.

See `docs/dependencies.md` for the policy governing these implementations and the promotion trigger (3+ defects in 6 months → library replacement ADR).

---

## BM25 text search

**Location:** `lib/storage/embeddings.mjs` — `bm25Score()`, `buildTermFrequencies()`, `buildIdf()`, `rankByBm25()`  
**LOC:** ~80 (within 158-line file)  
**Test coverage:** `tests/storage-hybrid.test.mjs`, `tests/observation-store.test.mjs`  
**What it does:** Okapi BM25 ranking over tokenized text. Used in the hybrid retrieval path of `lib/observation-store.mjs` as the keyword-recall leg alongside cosine vector search.  
**Parameters:** K1=1.5 (term saturation), B=0.75 (length normalization) — hardcoded, not tunable at runtime.

**Known limitations:**
- No IDF persistence — IDF is recomputed from the full corpus on every query. Scales O(n) with observation count.
- Tokenizer is whitespace + punctuation split only; no stemming, no stopword removal. Low recall on morphological variants.
- No field-weighted BM25 (title vs. body weighting).

**Nearest library alternative:** `wink-bm25-text-search` (MIT, ~200K weekly downloads) or `lunr` (MIT, ~500K weekly downloads). Either would provide stemming, stopwords, and persistent index serialization.

---

## Cosine similarity + hashing bag-of-words embeddings

**Location:** `lib/storage/embeddings.mjs` — `embedText()`, `cosineSimilarity()`, `scoreEmbeddedDocuments()`  
**LOC:** ~60 (within 158-line file)  
**Test coverage:** `tests/storage-hybrid.test.mjs`  
**What it does:** Produces 256-dimension float32 vectors via a hashing bag-of-words model (`hashing-bow-v1`). Cosine similarity used as the vector-recall leg in hybrid retrieval.

**Known limitations:**
- Hashing BOW has no semantic understanding — "happy" and "joyful" produce unrelated vectors.
- 256 dimensions is very low; collisions in the hash space reduce precision on large corpora (>5K observations).
- No batching — each document is embedded independently with no SIMD optimization.
- `EMBEDDING_MODEL = 'hashing-bow-v1'` is a custom identifier; not interchangeable with any external embedding model.

**Nearest library alternative:** Replace with a real embedding model via `@xenova/transformers` (Apache-2.0, ONNX-based, runs in Node without a GPU) for semantic embeddings, or `orama` for an integrated full-text + vector search store. Both would require a services-zone exemption or a core-zone ADR.

---

## UUIDv7 generation

**Location:** `lib/doc-stamp.mjs` — `uuidv7()`  
**LOC:** ~15  
**Test coverage:** `tests/doc-stamp.test.mjs` (indirect — stamps are verified for format)  
**What it does:** Generates time-ordered UUIDs per RFC 9562 §5.7. Used as the `cx_doc_id` for every observation, entity, and session record so IDs sort chronologically without a separate `created_at` index.

**Known limitations:**
- Monotonic counter for same-millisecond IDs is not persisted across process restarts — sub-ms ordering is not guaranteed across hot reloads.
- No variant/version validation on inbound UUIDs.

**Nearest library alternative:** `uuid` package (MIT, 100M+ weekly downloads) provides `v7()` with RFC-compliant monotonic counter. ~1KB minified — the most defensible case for a future core dep exception given the RFC compliance requirement.

---

## Observation store (hybrid retrieval)

**Location:** `lib/observation-store.mjs`  
**LOC:** 278  
**Test coverage:** `tests/observation-store.test.mjs` (comprehensive — add, search, filter, persist, role/project scoping)  
**What it does:** Persists structured observations to JSON files under `~/.cx/observations/`, maintains an in-memory vector index and BM25 corpus, and provides hybrid BM25+cosine search with category/role/project filters.

**Known limitations:**
- Full corpus loaded into memory on every process start. For >10K observations, startup latency and RSS will be noticeable.
- No WAL or fsync guarantees — crash during write could corrupt the observation file.
- Search ranking combines BM25 and cosine scores with a fixed 0.6/0.4 weight split — not tunable.

**Nearest library alternative:** `orama` (Apache-2.0) for integrated search, or Postgres full-text search via the existing `postgres` dep once the SQL backend is fully adopted.

---

## Entity store

**Location:** `lib/entity-store.mjs`  
**LOC:** 195  
**Test coverage:** `tests/entity-store.test.mjs` (comprehensive — create, update, link observations, persist)  
**What it does:** Tracks named entities (components, services, APIs, concepts) with linked observation IDs. Persisted to `~/.cx/entities/`. Enables "what do we know about X?" queries by entity name.

**Known limitations:**
- Linear scan for entity lookup by name — no index. Degrades at >1K entities.
- No deduplication heuristics — "UserService" and "user-service" are distinct entities.

**Nearest library alternative:** Would be subsumed by a Postgres migration (entity table + full-text index on name/summary). No external library needed once SQL backend is primary.

---

## Session store

**Location:** `lib/storage/` (session-related files)  
**Test coverage:** `tests/session-store.test.mjs`  
**What it does:** Persists session records (summary, decisions, files changed, open questions, task snapshot) as JSON under `~/.cx/sessions/`.

**Known limitations:**
- No query capability beyond list + load-by-id. Search is linear scan.
- No TTL or compaction — session files accumulate indefinitely.

**Nearest library alternative:** Postgres `sessions` table once SQL backend is fully adopted.

---

## Maintenance summary

| Component | LOC | Tests | Known defects | Promotion risk |
|---|---|---|---|---|
| BM25 | ~80 | Yes | IDF recompute cost, no stemming | Medium — will degrade at scale |
| Cosine/BOW | ~60 | Yes | No semantics, hash collisions | High — semantic recall is fundamentally limited |
| UUIDv7 | ~15 | Indirect | Sub-ms ordering on restart | Low — works for all current use cases |
| Observation store | 278 | Yes | Memory load, no WAL | Medium — will degrade at >10K obs |
| Entity store | 195 | Yes | Linear scan, no dedup | Low — adequate for current scale |
| Session store | ~100 | Yes | No TTL, linear search | Low — adequate for current scale |
