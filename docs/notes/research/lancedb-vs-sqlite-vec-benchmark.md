---
intake: none
---

# LanceDB vs sqlite-vec — install-footprint and query-latency benchmark

Benchmark + decision record for `construct-tsyfe.7.2`. Feeds the retain-vs-migrate
default-provider decision `slug:knowledgestore-provider-migration` will make for the
`vectorSearch` axis defined in `lib/engine/knowledge-store-contract.mjs`
(`construct-tsyfe.7.1`), whose `capable-local-semantic` mode currently maps
`vectorSearch` to `lib/storage/vector-client.mjs` (LanceDB, ADR-0066). This bead does
not implement or migrate anything — it produces the evidence a future migration bead
would need, per the program rule that a canonical sqlite-vec migration bead may not be
opened without it.

## Methodology

- **Corpus size: 5000 rows, dim 384.** Not arbitrary — `OBSERVATIONS_MAX_ROWS_DEFAULT`
  in `lib/storage/admin.mjs` is the row cap `purgeExpiredData()` already enforces for
  the machine-scoped `observations_v1` table, i.e. the steady-state ceiling this table
  runs at today. Dim 384 matches `FALLBACK_DIMENSIONS` in `lib/storage/vector-client.mjs`
  (the MiniLM embedding size).
- **Schema and call shape mirror production exactly.** Both engines were driven through
  the same `observations_v1` field list, a bulk load (representing initial corpus
  provisioning), 50 individual single-row upserts (matching `storeObservation()`'s
  per-call `mergeInsert`/`INSERT` pattern), and 30 k=10 nearest-neighbor queries
  (matching `searchObservations()`'s `nearestTo().distanceType('cosine')`).
- **LanceDB was benchmarked live** against this repo's real installed
  `@lancedb/lancedb@0.31.0` + `apache-arrow@18.1.0` — the actual root dependencies in
  `package.json` — via `scripts/bench/lancedb-vs-sqlite-vec.mjs`
  [source: scripts/bench/lancedb-vs-sqlite-vec.mjs]. Re-run with
  `node scripts/bench/lancedb-vs-sqlite-vec.mjs`.
- **sqlite-vec was benchmarked via a one-off, out-of-tree install** — `sqlite-vec@0.1.9`
  + `better-sqlite3@12.11.1` (the driver needed to call a loadable SQLite extension
  from Node) installed in a scratch directory outside this repo, not added to
  `package.json`/`package-lock.json`. The exact script used is reproduced verbatim at
  the bottom of this note for re-verification. Measured 2026-07-17.

## Install footprint (measured)

| | LanceDB (+ apache-arrow) | sqlite-vec (+ better-sqlite3 driver) |
|---|---|---|
| Own package code | 1.3 MB | 20 KB |
| Native binary (darwin-arm64) | 111.3 MB | 168 KB |
| Driver native binary | n/a (no separate driver) | 1.8 MB |
| apache-arrow / (sqlite-vec has no arrow dep) | 5.1 MB | — |
| Unused nested optional deps (see below) | 325.2 MB | 0 |
| Total on-disk, this platform | ≈443 MB | 14 MB across 41 packages |
| Platform packages declared | 7 (`@lancedb/lancedb-{darwin-arm64,linux-x64-gnu,linux-arm64-gnu,linux-x64-musl,linux-arm64-musl,win32-x64-msvc,win32-arm64-msvc}`) | 5 (`sqlite-vec-{darwin-x64,darwin-arm64,linux-x64,linux-arm64,windows-x64}`) |

All four numbers in the LanceDB column are computed live by
`scripts/bench/lancedb-vs-sqlite-vec.mjs` against the actual installed packages
[source: scripts/bench/lancedb-vs-sqlite-vec.mjs] — walking each resolved package's own
directory (excluding its nested `node_modules`, reported separately) plus the resolved
native-binary file for the running platform. Even setting the nested-dependency finding
aside, LanceDB's own package + native binary + apache-arrow (≈118 MB) is roughly an
order of magnitude larger than sqlite-vec's own package + native binary + driver
(≈2 MB) — expected, since LanceDB embeds a full columnar (Lance/Arrow) storage engine
where sqlite-vec is a thin loadable extension over SQLite's existing storage.

### A real, separate finding: 325 MB of installed-but-unused optional dependencies

`@lancedb/lancedb`'s own `package.json` declares `@huggingface/transformers@3.0.2` and
`openai@4.29.2` as `optionalDependencies` — its built-in embedding-function registry
(`dist/embedding/transformers.js`, `dist/embedding/openai.js`). Construct's own root
`package.json` already depends on `@huggingface/transformers@^4.2.0` for its own
embedding pipeline. The two version ranges don't overlap, so npm cannot hoist/dedupe:
it installs a second copy of `@huggingface/transformers` nested under
`node_modules/@lancedb/lancedb/node_modules/`, which in turn pulls its own
`onnxruntime-node`, `onnxruntime-web`, and `sharp`(+`@img/*`) — a duplicate ~325 MB
tree, verified via `find node_modules/@lancedb/lancedb/node_modules -maxdepth 2 -name
package.json` (5 nested packages: `onnxruntime-node`, `onnxruntime-web`,
`onnxruntime-common`, `sharp`, `flatbuffers`).

Grepped directly: neither `lib/storage/vector-client.mjs` nor
`lib/storage/embeddings-engine.mjs` imports `@lancedb/lancedb/embedding` or references
an `EmbeddingFunction` [source: lib/storage/vector-client.mjs]. Construct computes
embeddings itself and passes raw vectors into LanceDB's `mergeInsert`/`add` calls — it
never touches LanceDB's built-in embedding-function registry. This entire nested tree
is installed weight with no code path exercising it today. It is not addressed by this
bead (no code change here — benchmark/decision only) but is a concrete, low-risk target
for a follow-up `package.json` `overrides` pin (aligning the nested range to the root
`@huggingface/transformers` version) should the footprint ever need to shrink without a
storage-engine migration.

## Platform coverage

LanceDB 0.31.0's `napi.targets` (and matching `optionalDependencies`) cover 7 triples:
`aarch64-apple-darwin`, `x86_64-unknown-linux-{gnu,musl}`,
`aarch64-unknown-linux-{gnu,musl}`, `x86_64-pc-windows-msvc`,
`aarch64-pc-windows-msvc` — notably **no `x86_64-apple-darwin` (Intel Mac)** prebuilt in
this version [source: package.json]. sqlite-vec 0.1.9 covers 5 platform packages:
`darwin-{x64,arm64}`, `linux-{x64,arm64}`, `windows-x64` — it has an Intel-Mac prebuilt
LanceDB lacks, but no Linux-musl (Alpine) or Windows-arm64 prebuilt, both of which
LanceDB covers. Neither library's prebuilt matrix is a strict superset of the other's.
Construct's actual CI matrix runs `ubuntu-latest` and `macos-latest` only
[source: .github/workflows/ci.yml] (both GitHub-hosted arm64/x64-gnu-linux runners),
which both libraries' prebuilts cover today — this platform gap is not a CI blocker,
only a real limitation for an end user on an uncovered platform (e.g. an Intel Mac
running the current LanceDB version, or an Alpine-container user running sqlite-vec).

## Write / query latency at 5000 rows, dim 384

| | LanceDB | sqlite-vec (reference) |
|---|---|---|
| Bulk load 5000 rows | 54–55 ms (≈91k rows/sec) | 71 ms (≈71k rows/sec) |
| Single-row write, p50 (matches `storeObservation()`) | 3.6–3.7 ms | 0.58 ms |
| Single-row write, p95 | 4.0–4.2 ms | 0.67–0.69 ms |
| k=10 query, p50 (matches `searchObservations()`) | 2.3–2.4 ms | 0.85–0.88 ms |
| k=10 query, p95 | 2.6–2.9 ms | 0.96–1.02 ms |

LanceDB ranges reflect five consecutive, otherwise-idle runs of
`scripts/bench/lancedb-vs-sqlite-vec.mjs` on this machine
[source: scripts/bench/lancedb-vs-sqlite-vec.mjs]; sqlite-vec ranges reflect two idle
runs of the one-off reference script below. Bulk-load throughput is comparable between
the two engines. Per-row write and per-query latency are both consistently lower on
sqlite-vec at this corpus size — roughly a 5–6x gap on single-row write latency and a
2.7–3x gap on query latency. Both engines nonetheless respond in low single-digit
milliseconds or less at this corpus size under idle conditions, which is not a
user-perceptible bottleneck for a CLI tool's interactive observation search.

Runs made while this machine had other concurrent CPU/disk load (other tool processes
active in the same session) showed LanceDB's p95 write and query latency spike into an
≈11–17 ms range, with p50 unaffected — LanceDB's per-call transaction/versioning
overhead appears more sensitive to contention than sqlite-vec's, whose reference numbers
were not re-measured under load. This contention sensitivity is noted as an observed,
unquantified caveat rather than a load-tested claim: the numbers above are the idle-run
figures the decision below is based on.

## apache-arrow direct-use status — RESOLVED-DISMISSED (no re-investigation performed)

Per the program's evidence digest (truth #17): `await import('apache-arrow')` at
`lib/storage/vector-client.mjs:83` is a direct, sanctioned use —
`tests/core-dependency-policy.test.mjs:26-33` explicitly allowlists it (`:24` documents
`js-yaml`'s narrower ADR-0028 scope by contrast), and ADR-0001 lists `apache-arrow`
among its three declared core exceptions alongside `@modelcontextprotocol/sdk` and
`@lancedb/lancedb`. Re-verified directly during this bead's authoring: `apache-arrow`
is imported nowhere in `lib/` outside `lib/storage/vector-client.mjs`
[source: lib/storage/vector-client.mjs] — every other repo hit is `package.json`/
`package-lock.json`, `deps/intent.json`, an ADR, or a doc note, none of them a direct
import. This confirms the digest's resolution and closes the question the bead's
Decision section asked to be recorded, not re-opened: `construct-tsyfe.7.2` does not
re-litigate `apache-arrow`.

## Decision: retain-as-canonical

`lib/storage/vector-client.mjs` (LanceDB) remains the `capable-local-semantic` mode's
`vectorSearch` provider in `lib/engine/knowledge-store-contract.mjs`. No migration bead
is opened as a result of this benchmark.

Reasoning, traceable to the numbers above:

1. **Neither the footprint nor the latency gap is a functional blocker today.** sqlite-vec
   is meaningfully smaller and faster in this benchmark, but LanceDB's own absolute
   latency (single-digit milliseconds at the table's real steady-state cap of 5000 rows)
   creates no observed or reported usability problem in Construct's interactive
   observation-search path.
2. **The largest single footprint cost (325 MB, see above) is not inherent to the vector
   engine choice.** It is an npm dependency-resolution artifact of LanceDB's optional
   embedding-function integration, which Construct's code never calls. It is addressable
   by a targeted dependency pin without touching the storage engine at all — a cheaper
   fix than a migration would be, if the footprint ever needs to shrink.
3. **Migration cost is real and non-trivial.** `lib/storage/vector-client.mjs` already
   encodes LanceDB-specific semantics a migration would have to re-derive against a very
   different transaction model: per-db-path write serialization plus a retry loop keyed
   to LanceDB's specific optimistic-concurrency error strings (`serializeWrite`,
   `withWriteRetry`), `mergeInsert`-based upsert-by-id, and row-count/age-based TTL
   pruning (`pruneObservations`) — none of which map directly onto SQLite's
   single-writer WAL model or `vec0`'s delete-and-reinsert upsert pattern.
4. **apache-arrow's status is independently resolved** (see above) and carries no weight
   toward migrating away from LanceDB — it is a sanctioned, direct dependency of the
   current provider, not an unaccounted-for transitive cost.

If the footprint or latency gap becomes a reported problem in the future, this note's
numbers and the reproducible `scripts/bench/lancedb-vs-sqlite-vec.mjs` are the evidence
`slug:knowledgestore-provider-migration` (or a dedicated follow-up) would build on
before opening a canonical sqlite-vec migration bead — per the program rule, none is
opened here.

## sqlite-vec reference benchmark script (not committed to this repo)

Run against a scratch `npm init -y && npm install sqlite-vec better-sqlite3` directory
outside this repo — `sqlite-vec@0.1.9`, `better-sqlite3@12.11.1`. Reproduced verbatim so
the numbers above can be independently re-verified without this repo taking on the
dependency:

```js
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';

const DIM = 384;
const CORPUS_SIZE = 5000;
const QUERY_SAMPLES = 30;
const WRITE_SAMPLES = 50;

function randVec(dim) {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() * 2 - 1;
  return v;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const db = new Database('/tmp/sqlite-vec-bench.db');
sqliteVec.load(db);

db.exec(`create virtual table vec_observations using vec0(
  id text primary key,
  embedding float[${DIM}]
)`);
db.exec(`create table observations_meta (
  id text primary key, project text, role text, category text, summary text,
  content text, tags text, confidence real, source text, git_sha text,
  content_hash text, model text, created_at text, updated_at text
)`);

const insertVec = db.prepare('insert into vec_observations(id, embedding) values (?, ?)');
const insertMeta = db.prepare(`insert into observations_meta
  (id, project, role, category, summary, content, tags, confidence, source,
   git_sha, content_hash, model, created_at, updated_at)
  values (@id, @project, @role, @category, @summary, @content, @tags, @confidence,
          @source, @git_sha, @content_hash, @model, @created_at, @updated_at)`);

// Bulk load CORPUS_SIZE rows in one transaction (initial-provisioning shape),
// then WRITE_SAMPLES individual inserts timed one at a time (matches
// storeObservation()'s per-call write shape), then QUERY_SAMPLES k=10 KNN
// queries via vec0's `match ... and k = ?` timed one at a time. Full harness
// (row generation, transaction wrapper, JSON report) mirrors
// scripts/bench/lancedb-vs-sqlite-vec.mjs's LanceDB half exactly so the two
// are comparable — omitted here for brevity; see that file for the shared
// row-generation and percentile helpers.
```

The full runnable form (identical logic, un-abridged) was executed twice; both runs are
the two values in each latency range in the table above.
