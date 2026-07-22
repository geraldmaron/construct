#!/usr/bin/env node
/**
 * scripts/bench/lancedb-vs-sqlite-vec.mjs — LanceDB footprint/latency
 * benchmark for construct-tsyfe.7.2 (retain-vs-migrate decision input for
 * slug:knowledgestore-provider-migration's vectorSearch axis).
 *
 * Runs a live benchmark against the real installed `@lancedb/lancedb` +
 * `apache-arrow` (the current canonical `vectorSearch` provider behind
 * lib/storage/vector-client.mjs) using the exact `observations_v1` schema
 * and write/query call shapes that module uses in production
 * (`table.add()` for bulk load, `table.mergeInsert('id')...execute()` for a
 * single upsert matching `storeObservation()`, `table.query().nearestTo()`
 * for a k-NN search matching `searchObservations()`).
 *
 * Corpus size (5000 rows) is not arbitrary: it is
 * `OBSERVATIONS_MAX_ROWS_DEFAULT` in lib/storage/admin.mjs, the row cap
 * `purgeExpiredData()` already enforces for the machine-scoped observations
 * store — i.e. the steady-state ceiling this table already runs at today.
 *
 * sqlite-vec is NOT a repo dependency (per program instruction, this bead
 * does not add one) and is therefore not benchmarked live here. Its numbers
 * below are a frozen one-off measurement against a temporary out-of-tree
 * install (sqlite-vec 0.1.9 + better-sqlite3 12.11.1, same corpus size,
 * schema, and query shape as this script) — see the decision record at
 * docs/notes/research/lancedb-vs-sqlite-vec-benchmark.md for full
 * methodology, install-footprint numbers, and the sqlite-vec benchmark
 * script text in full.
 *
 * Usage: node scripts/bench/lancedb-vs-sqlite-vec.mjs [--corpus=5000] [--json]
 */

import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);

const DIM = 384;
const CORPUS_SIZE = Number(args.corpus ?? 5000);
const QUERY_SAMPLES = 30;
const WRITE_SAMPLES = 50;
const JSON_ONLY = args.json === 'true';

// Frozen one-off measurement, not re-executed by this script — see file
// header. Recorded here so `node scripts/bench/lancedb-vs-sqlite-vec.mjs`
// prints one side-by-side comparison instead of two disjoint reports.

const SQLITE_VEC_REFERENCE = Object.freeze({
  engine: 'sqlite-vec',
  measuredAt: '2026-07-17',
  sqliteVecVersion: '0.1.9',
  driverVersion: 'better-sqlite3@12.11.1',
  dim: DIM,
  corpusSize: 5050,
  bulkLoadMs: 71,
  bulkLoadRowsPerSec: 70799,
  singleWrite: { samples: 50, p50Ms: 0.576, p95Ms: 0.67, maxMs: 0.812 },
  knnQuery: { samples: 30, k: 10, p50Ms: 0.847, p95Ms: 1.021, maxMs: 1.159 },
  installFootprint: {
    totalNodeModulesBytes: 14 * 1024 * 1024,
    ownPackageBytes: 20 * 1024,
    nativeBinaryBytes: 168 * 1024,
    driverNativeBinaryBytes: 1.8 * 1024 * 1024,
    packageCount: 41,
    platformPackages: [
      'sqlite-vec-darwin-x64', 'sqlite-vec-darwin-arm64',
      'sqlite-vec-linux-x64', 'sqlite-vec-linux-arm64',
      'sqlite-vec-windows-x64',
    ],
  },
});

function randVec(dim) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.random() * 2 - 1;
  return v;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function round(n, digits = 3) {
  return Number(n.toFixed(digits));
}

// Walks a resolved package's own directory (excluding its nested
// node_modules, reported separately) so the "own code" figure isn't
// inflated by transitive deps npm couldn't hoist.

function dirSize(dir, { excludeNodeModules = false } = {}) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (excludeNodeModules && entry.name === 'node_modules') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { total += fs.statSync(full).size; } catch { /* race with concurrent writers */ }
      }
    }
  };
  walk(dir);
  return total;
}

async function resolvePackageRoot(specifier, fromFile) {
  const resolved = await import.meta.resolve(specifier, url.pathToFileURL(fromFile));
  let dir = path.dirname(url.fileURLToPath(resolved));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not find package.json for ${specifier}`);
    dir = parent;
  }
  return dir;
}

async function measureLanceDbFootprint() {
  const lancedbRoot = await resolvePackageRoot('@lancedb/lancedb', import.meta.url);
  const arrowRoot = await resolvePackageRoot('apache-arrow', import.meta.url);
  const ownBytes = dirSize(lancedbRoot, { excludeNodeModules: true });
  const nestedNodeModules = path.join(lancedbRoot, 'node_modules');
  const nestedBytes = fs.existsSync(nestedNodeModules) ? dirSize(nestedNodeModules) : 0;
  const arrowBytes = dirSize(arrowRoot);

  const platformPkgPath = path.join(path.dirname(lancedbRoot), `lancedb-${process.platform}-${process.arch === 'x64' ? 'x64' : process.arch}`);
  let nativeBytes = 0;
  let nativeBinaryPath = null;
  if (fs.existsSync(platformPkgPath)) {
    const nodeFile = fs.readdirSync(platformPkgPath).find((f) => f.endsWith('.node'));
    if (nodeFile) {
      nativeBinaryPath = path.join(platformPkgPath, nodeFile);
      nativeBytes = fs.statSync(nativeBinaryPath).size;
    }
  }

  const pkgJson = JSON.parse(fs.readFileSync(path.join(lancedbRoot, 'package.json'), 'utf8'));
  const platformPackages = Object.keys(pkgJson.optionalDependencies || {}).filter((k) => k.startsWith('@lancedb/lancedb-'));

  return {
    lancedbOwnBytes: ownBytes,
    lancedbNestedOptionalDepsBytes: nestedBytes,
    apacheArrowBytes: arrowBytes,
    nativeBinaryBytes: nativeBytes,
    nativeBinaryPath,
    platform: `${process.platform}-${process.arch}`,
    platformPackages,
  };
}

async function benchLanceDb() {
  const lancedb = await import('@lancedb/lancedb');
  const arrow = await import('apache-arrow');

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lancedb-bench-'));
  const db = await lancedb.connect(dbPath);

  const schema = new arrow.Schema([
    new arrow.Field('id', new arrow.Utf8()),
    new arrow.Field('project', new arrow.Utf8(), true),
    new arrow.Field('role', new arrow.Utf8(), true),
    new arrow.Field('category', new arrow.Utf8(), true),
    new arrow.Field('summary', new arrow.Utf8(), true),
    new arrow.Field('content', new arrow.Utf8(), true),
    new arrow.Field('tags', new arrow.Utf8(), true),
    new arrow.Field('confidence', new arrow.Float32(), true),
    new arrow.Field('source', new arrow.Utf8(), true),
    new arrow.Field('git_sha', new arrow.Utf8(), true),
    new arrow.Field('embedding', new arrow.FixedSizeList(DIM, new arrow.Field('item', new arrow.Float32()))),
    new arrow.Field('content_hash', new arrow.Utf8(), true),
    new arrow.Field('model', new arrow.Utf8(), true),
    new arrow.Field('created_at', new arrow.Utf8(), true),
    new arrow.Field('updated_at', new arrow.Utf8(), true),
  ]);

  const table = await db.createTable('observations_v1', [], { schema });

  const makeRow = (id, i) => {
    const now = new Date().toISOString();
    return {
      id, project: 'construct', role: 'cx-engineer', category: 'insight',
      summary: `synthetic observation ${i}`, content: `synthetic content body ${i}`,
      tags: '[]', confidence: 0.8, source: 'bench', git_sha: '',
      embedding: randVec(DIM), content_hash: '', model: 'bench-synthetic',
      created_at: now, updated_at: now,
    };
  };

  const bulkRows = [];
  for (let i = 0; i < CORPUS_SIZE; i++) bulkRows.push(makeRow(`obs-bulk-${i}`, i));

  const bulkStart = performance.now();
  await table.add(bulkRows);
  const bulkMs = performance.now() - bulkStart;

  const writeLatencies = [];
  for (let i = 0; i < WRITE_SAMPLES; i++) {
    const row = makeRow(`obs-single-${i}`, i);
    const t0 = performance.now();
    await table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute([row]);
    writeLatencies.push(performance.now() - t0);
  }

  const totalRows = await table.countRows();

  const queryLatencies = [];
  for (let i = 0; i < QUERY_SAMPLES; i++) {
    const q = randVec(DIM);
    const t0 = performance.now();
    const rows = await table.query().nearestTo(q).distanceType('cosine').limit(10).toArray();
    queryLatencies.push(performance.now() - t0);
    if (rows.length !== 10) throw new Error(`expected 10 results, got ${rows.length}`);
  }

  fs.rmSync(dbPath, { recursive: true, force: true });

  return {
    engine: 'lancedb',
    dim: DIM,
    corpusSize: totalRows,
    bulkLoadMs: Math.round(bulkMs),
    bulkLoadRowsPerSec: Math.round((CORPUS_SIZE / bulkMs) * 1000),
    singleWrite: {
      samples: WRITE_SAMPLES,
      p50Ms: round(percentile(writeLatencies, 50)),
      p95Ms: round(percentile(writeLatencies, 95)),
      maxMs: round(Math.max(...writeLatencies)),
    },
    knnQuery: {
      samples: QUERY_SAMPLES,
      k: 10,
      p50Ms: round(percentile(queryLatencies, 50)),
      p95Ms: round(percentile(queryLatencies, 95)),
      maxMs: round(Math.max(...queryLatencies)),
    },
  };
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main() {
  const footprint = await measureLanceDbFootprint();
  const lancedbResult = await benchLanceDb();

  if (JSON_ONLY) {
    console.log(JSON.stringify({ footprint, lancedb: lancedbResult, sqliteVecReference: SQLITE_VEC_REFERENCE }, null, 2));
    return;
  }

  console.log('LanceDB vs sqlite-vec — construct-tsyfe.7.2 benchmark');
  console.log(`Corpus size: ${CORPUS_SIZE} rows, dim=${DIM} (OBSERVATIONS_MAX_ROWS_DEFAULT, lib/storage/admin.mjs)`);
  console.log('');
  console.log('Install footprint (live-measured, this install):');
  console.log(`  @lancedb/lancedb own code       ${formatBytes(footprint.lancedbOwnBytes)}`);
  console.log(`  apache-arrow                    ${formatBytes(footprint.apacheArrowBytes)}`);
  console.log(`  native binary (${footprint.platform})   ${footprint.nativeBinaryBytes ? formatBytes(footprint.nativeBinaryBytes) : 'not found for this platform'}`);
  console.log(`  unused nested optional deps     ${formatBytes(footprint.lancedbNestedOptionalDepsBytes)} (onnxruntime-node/web + a second @huggingface/transformers copy, pulled in by @lancedb/lancedb's own optionalDependencies on an embedding-function registry Construct's code never imports)`);
  console.log(`  platform packages declared      ${footprint.platformPackages.length} (${footprint.platformPackages.join(', ')})`);
  console.log('');
  console.log('sqlite-vec reference (frozen one-off measurement, not re-run — see file header):');
  console.log(`  own package + native binary     ${formatBytes(SQLITE_VEC_REFERENCE.installFootprint.ownPackageBytes + SQLITE_VEC_REFERENCE.installFootprint.nativeBinaryBytes)}`);
  console.log(`  + driver (better-sqlite3)        ${formatBytes(SQLITE_VEC_REFERENCE.installFootprint.driverNativeBinaryBytes)}`);
  console.log(`  total node_modules               ${formatBytes(SQLITE_VEC_REFERENCE.installFootprint.totalNodeModulesBytes)} across ${SQLITE_VEC_REFERENCE.installFootprint.packageCount} packages`);
  console.log(`  platform packages declared      ${SQLITE_VEC_REFERENCE.installFootprint.platformPackages.length} (${SQLITE_VEC_REFERENCE.installFootprint.platformPackages.join(', ')})`);
  console.log('');
  console.log(`Bulk load ${CORPUS_SIZE} rows:`);
  console.log(`  lancedb      ${lancedbResult.bulkLoadMs}ms  (${lancedbResult.bulkLoadRowsPerSec} rows/sec)`);
  console.log(`  sqlite-vec   ${SQLITE_VEC_REFERENCE.bulkLoadMs}ms  (${SQLITE_VEC_REFERENCE.bulkLoadRowsPerSec} rows/sec)  [reference]`);
  console.log('');
  console.log('Single-row write latency (mergeInsert / INSERT, matching storeObservation()):');
  console.log(`  lancedb      p50=${lancedbResult.singleWrite.p50Ms}ms  p95=${lancedbResult.singleWrite.p95Ms}ms  max=${lancedbResult.singleWrite.maxMs}ms`);
  console.log(`  sqlite-vec   p50=${SQLITE_VEC_REFERENCE.singleWrite.p50Ms}ms  p95=${SQLITE_VEC_REFERENCE.singleWrite.p95Ms}ms  max=${SQLITE_VEC_REFERENCE.singleWrite.maxMs}ms  [reference]`);
  console.log('');
  console.log('k-NN query latency (k=10, matching searchObservations()):');
  console.log(`  lancedb      p50=${lancedbResult.knnQuery.p50Ms}ms  p95=${lancedbResult.knnQuery.p95Ms}ms  max=${lancedbResult.knnQuery.maxMs}ms`);
  console.log(`  sqlite-vec   p50=${SQLITE_VEC_REFERENCE.knnQuery.p50Ms}ms  p95=${SQLITE_VEC_REFERENCE.knnQuery.p95Ms}ms  max=${SQLITE_VEC_REFERENCE.knnQuery.maxMs}ms  [reference]`);
  console.log('');
  console.log('Full decision record: docs/notes/research/lancedb-vs-sqlite-vec-benchmark.md');
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exitCode = 1;
});
