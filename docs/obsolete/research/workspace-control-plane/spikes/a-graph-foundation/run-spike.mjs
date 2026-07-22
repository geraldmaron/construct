/**
 * run-spike.mjs — construct-b0nny.5.1, directive §11 Spike A ("graph
 * foundation"): independent measurement harness for the relational graph
 * store (lib/graph/relational/, construct-b0nny.3) already built and pinned
 * by tests/functional/graph-relational-store.functional.test.mjs.
 *
 * Scope: independent measurement only, no re-implementation or re-validation
 * of the 12 day-one milestones that functional test already pins. Coverage:
 * cold build time, incremental update time, query latency, impact
 * correctness (against an independently-computed oracle, not the store's own
 * seeder), reconciliation, cycle/orphan detection, storage footprint, and
 * cross-platform fallback.
 *
 * Isolation: every phase sets CX_HOME_OVERRIDE to a fresh tmp directory
 * (lib/paths.mjs homeDir() honors it unconditionally) so all graph.db state
 * lands under a disposable sandbox, never under the real ~/.construct — even
 * though `cwd` for the CLI processes is the real repo root (REPO_ROOT), so
 * the graph seeders scan real repo content and produce a real, representative
 * graph. Two sandboxes are used: SANDBOX_READ (cold build + all read-only
 * measurements against the real graph) and SANDBOX_MUTATE (incremental
 * update, cycle/orphan injection, reconciliation drift — anything that
 * intentionally corrupts state) so mutation experiments never contaminate
 * the read-latency measurements.
 *
 * Run: node docs/notes/research/workspace-control-plane/spikes/a-graph-foundation/run-spike.mjs
 * Output: results.json next to this file, plus a human-readable log on stdout.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'bin', 'construct'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('repo root not found walking up from ' + start);
    dir = parent;
  }
}

const REPO_ROOT = resolveRepoRoot(HERE);
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const results = { generatedAt: new Date().toISOString(), repoRoot: REPO_ROOT, nodeVersion: process.version, phases: {} };

function log(...args) { console.log(...args); }

function freshSandbox(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}

function runCLI(sandboxHome, args, { cwd = REPO_ROOT } = {}) {
  const t0 = process.hrtime.bigint();
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, HOME: sandboxHome, CX_HOME_OVERRIDE: sandboxHome },
  });
  const t1 = process.hrtime.bigint();
  return { ...res, ms: Number(t1 - t0) / 1e6 };
}

function runCLIJson(sandboxHome, args, opts) {
  const r = runCLI(sandboxHome, args, opts);
  if (r.status !== 0) throw new Error(`CLI failed (${args.join(' ')}) [exit ${r.status}]: ${r.stderr}`);
  const idx = r.stdout.indexOf('{');
  return { json: JSON.parse(r.stdout.slice(idx)), ms: r.ms, raw: r };
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], mean: sum / sorted.length, p50: p(0.5), p95: p(0.95) };
}

async function loadRelationalModules(sandboxHome) {
  process.env.CX_HOME_OVERRIDE = sandboxHome;
  process.env.HOME = sandboxHome;
  const outbox = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/outbox.mjs')).href);
  const sqliteDb = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/sqlite-db.mjs')).href);
  const sqliteStore = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/sqlite-store.mjs')).href);
  const queries = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/queries.mjs')).href);
  const reconcile = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/reconcile.mjs')).href);
  const workspace = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/workspace.mjs')).href);
  return { outbox, sqliteDb, sqliteStore, queries, reconcile, workspace };
}

function du(filePath) {
  try { return fs.statSync(filePath).size; } catch { return null; }
}

function findFile(dir, name) {
  let found = null;
  const walk = (d) => {
    if (found) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === name) found = full;
    }
  };
  walk(dir);
  return found;
}

// ---------------------------------------------------------------------------
// Phase 1: cold build time, storage footprint
// ---------------------------------------------------------------------------

async function phase1_coldBuild() {
  log('\n=== Phase 1: cold build time + storage footprint ===');
  const sandbox = freshSandbox('spikeA-coldbuild-');
  try {
    const cold = runCLIJson(sandbox, ['graph', 'build', '--no-co-change', '--json']);
    log(`cold build (--no-co-change): ${cold.ms.toFixed(1)}ms, nodes=${cold.json.nodeCount}, edges=${cold.json.edgeCount}`);

    const coldWithCoChange = runCLIJson(sandbox, ['graph', 'build', '--json']);
    log(`rebuild WITH co-change (warm DB, cold co-change git-log scan): ${coldWithCoChange.ms.toFixed(1)}ms, nodes=${coldWithCoChange.json.nodeCount}, edges=${coldWithCoChange.json.edgeCount}`);

    const warm = runCLIJson(sandbox, ['graph', 'build', '--no-co-change', '--json']);
    log(`warm rebuild (--no-co-change, DB already exists): ${warm.ms.toFixed(1)}ms`);

    const dbPath = findFile(sandbox, 'graph.db');
    const dbBytes = dbPath ? du(dbPath) : null;
    log(`graph.db path: ${dbPath}`);
    log(`graph.db size: ${dbBytes} bytes (${(dbBytes / 1024 / 1024).toFixed(2)} MiB)`);

    // Legacy JSONL snapshot written alongside, for a footprint comparison.
    const nodesJsonl = path.join(REPO_ROOT, '.construct/graph/nodes.jsonl');
    const edgesJsonl = path.join(REPO_ROOT, '.construct/graph/edges.jsonl');
    const jsonlBytes = (du(nodesJsonl) || 0) + (du(edgesJsonl) || 0);

    return {
      sandbox,
      coldBuildNoCoChangeMs: cold.ms,
      rebuildWithCoChangeMs: coldWithCoChange.ms,
      warmRebuildNoCoChangeMs: warm.ms,
      nodeCount: cold.json.nodeCount,
      edgeCount: cold.json.edgeCount,
      nodesByType: cold.json.meta.nodesByType,
      edgesByRel: cold.json.meta.edgesByRel,
      graphDbPath: dbPath,
      graphDbBytes: dbBytes,
      legacyJsonlSnapshotBytes: jsonlBytes,
    };
  } finally {
    // sandbox retained for phase 2 (query latency, impact correctness) — cleaned at end.
  }
}

// ---------------------------------------------------------------------------
// Phase 2: query latency (CLI round-trip and in-process SQL) against real data
// ---------------------------------------------------------------------------

async function phase2_queryLatency(sandbox, meta) {
  log('\n=== Phase 2: query latency (real repo graph) ===');
  const mods = await loadRelationalModules(sandbox);
  const { queries } = mods;

  // Pick a real hub node (heavily imported file) and a real leaf-ish node,
  // both present because meta.nodesByType.file > 0 in the real repo build.
  const hubCandidates = ['file:lib/config-dir.mjs', 'file:lib/paths.mjs', 'file:lib/state-root.mjs'];
  let hubId = null;
  for (const c of hubCandidates) {
    const row = queries.queryUp(REPO_ROOT, c, {});
    if (row && row.length > 0) { hubId = c; break; }
  }
  if (!hubId) throw new Error('no hub candidate found in real graph — repo layout changed?');

  const CLI_N = 20;
  const cliQueryTimes = [];
  for (let i = 0; i < CLI_N; i++) {
    const r = runCLI(sandbox, ['graph', 'query', hubId, '--json']);
    if (r.status !== 0) throw new Error(`graph query failed: ${r.stderr}`);
    cliQueryTimes.push(r.ms);
  }
  const cliStats = stats(cliQueryTimes);
  log(`CLI round-trip 'graph query ${hubId}' x${CLI_N}: mean=${cliStats.mean.toFixed(1)}ms p50=${cliStats.p50.toFixed(1)}ms p95=${cliStats.p95.toFixed(1)}ms min=${cliStats.min.toFixed(1)}ms`);

  // In-process SQL-only timing (excludes node startup + process spawn), same node.
  const SQL_N = 50;
  const upTimes = [];
  for (let i = 0; i < SQL_N; i++) {
    const t0 = process.hrtime.bigint();
    queries.queryUp(REPO_ROOT, hubId, {});
    upTimes.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const upStats = stats(upTimes);
  log(`in-process SQL queryUp(${hubId}, default maxDepth=50) x${SQL_N}: mean=${upStats.mean.toFixed(3)}ms p95=${upStats.p95.toFixed(3)}ms`);

  // queryDown (unrestricted rel, transitive "who imports this transitively")
  // from a hub node hit a genuine wall during manual probing before this
  // script's first full run: depth 1/2/3 completed in 71/488/2066ms but
  // depth 5+ did not return inside a 12s hard kill, on this repo's own
  // 3107-node/8132-edge graph (4297 of those edges are 'imports', dense and
  // cyclic — the same shape queries.mjs's own comment already flagged for
  // queryCycles at a smaller prior graph size). QUERY_DOWN has no rel filter
  // parameter (unlike queryCycles/queryImpact), so the only lever is
  // maxDepth; each probe runs in its own child process with a hard kill so a
  // hang cannot stall this harness.
  const downDepthProbe = [];
  for (const maxDepth of [1, 2, 3, 5, 8]) {
    const child = spawnSync(process.execPath, ['-e', `
      process.env.CX_HOME_OVERRIDE = ${JSON.stringify(sandbox)};
      process.env.HOME = ${JSON.stringify(sandbox)};
      import('${pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/queries.mjs')).href}').then(({ queryDown }) => {
        const t0 = process.hrtime.bigint();
        const rows = queryDown(${JSON.stringify(REPO_ROOT)}, ${JSON.stringify(hubId)}, { maxDepth: ${maxDepth} });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(JSON.stringify({ ms, count: rows.length }));
      });
    `], { encoding: 'utf8', timeout: 12000, killSignal: 'SIGKILL' });
    if (child.status === 0 && child.stdout.trim()) {
      const r = JSON.parse(child.stdout.trim());
      downDepthProbe.push({ maxDepth, ms: r.ms, rows: r.count, timedOut: false });
      log(`in-process SQL queryDown(${hubId}, maxDepth=${maxDepth}): ${r.ms.toFixed(1)}ms, rows=${r.count}`);
    } else {
      downDepthProbe.push({ maxDepth, ms: null, rows: null, timedOut: true });
      log(`in-process SQL queryDown(${hubId}, maxDepth=${maxDepth}): TIMED OUT/KILLED after 12000ms (status=${child.status}, signal=${child.signal})`);
    }
  }

  // path query between two real, known-connected nodes: bin/construct
  // directly imports lib/cli-commands.mjs (grep-verified, 1 hop), which is
  // known to transitively reach lib/graph/store.mjs. QUERY_PATH has the same
  // no-rel-filter/default-maxDepth=50 shape as QUERY_DOWN above, so it is run
  // the same bounded, hard-killed way rather than in-process at the default
  // depth — an in-process default-depth call from bin/construct hung this
  // harness for 4+ minutes before this fix.
  const fromNode = 'file:bin/construct';
  const toNode = 'file:lib/graph/store.mjs';
  const pathProbe = [];
  let pathResult = null;
  for (const maxDepth of [3, 6, 10]) {
    const child = spawnSync(process.execPath, ['-e', `
      process.env.CX_HOME_OVERRIDE = ${JSON.stringify(sandbox)};
      process.env.HOME = ${JSON.stringify(sandbox)};
      import('${pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/queries.mjs')).href}').then(({ queryPath }) => {
        const t0 = process.hrtime.bigint();
        const result = queryPath(${JSON.stringify(REPO_ROOT)}, ${JSON.stringify(fromNode)}, ${JSON.stringify(toNode)}, { maxDepth: ${maxDepth} });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(JSON.stringify({ ms, found: !!result, depth: result?.depth ?? null, chain: result?.chain ?? null }));
      });
    `], { encoding: 'utf8', timeout: 12000, killSignal: 'SIGKILL' });
    if (child.status === 0 && child.stdout.trim()) {
      const r = JSON.parse(child.stdout.trim());
      pathProbe.push({ maxDepth, ms: r.ms, found: r.found, depth: r.depth, timedOut: false });
      log(`in-process SQL queryPath(${fromNode} -> ${toNode}, maxDepth=${maxDepth}): ${r.ms.toFixed(1)}ms, found=${r.found}${r.found ? `, depth=${r.depth}` : ''}`);
      if (r.found) { pathResult = r; break; }
    } else {
      pathProbe.push({ maxDepth, ms: null, found: null, depth: null, timedOut: true });
      log(`in-process SQL queryPath(${fromNode} -> ${toNode}, maxDepth=${maxDepth}): TIMED OUT/KILLED after 12000ms`);
    }
  }

  // cycles/orphans latency against the whole real graph (no synthetic data yet)
  let t0 = process.hrtime.bigint();
  const cyclesReal = queries.queryCycles(REPO_ROOT, {});
  const cyclesMs = Number(process.hrtime.bigint() - t0) / 1e6;
  log(`in-process SQL queryCycles (default rels, real graph, no synthetic cycle yet): ${cyclesMs.toFixed(1)}ms, members found=${cyclesReal.length}`);

  t0 = process.hrtime.bigint();
  const orphansReal = queries.queryOrphans(REPO_ROOT);
  const orphansMs = Number(process.hrtime.bigint() - t0) / 1e6;
  log(`in-process SQL queryOrphans (real graph): ${orphansMs.toFixed(1)}ms, orphans found=${orphansReal.length}`);

  // The 'imports' rel is dense (per queries.mjs's own comment, this caused a
  // multi-minute hang on this repo's earlier 2.3k/6.3k graph during b0nny.3
  // dev) — confirm current (larger, 3085/8132) behavior for real rather than
  // trusting the old comment, with a bounded timeout via a child process.
  const importsCyclesProbe = spawnSync(process.execPath, ['-e', `
    process.env.CX_HOME_OVERRIDE = ${JSON.stringify(sandbox)};
    process.env.HOME = ${JSON.stringify(sandbox)};
    import('${pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/queries.mjs')).href}').then(({ queryCycles }) => {
      const t0 = process.hrtime.bigint();
      const rows = queryCycles(${JSON.stringify(REPO_ROOT)}, { rels: ['imports'], maxDepth: 15 });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(JSON.stringify({ ms, count: rows.length }));
    });
  `], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
  let importsCyclesResult = null;
  if (importsCyclesProbe.status === 0 && importsCyclesProbe.stdout.trim()) {
    importsCyclesResult = JSON.parse(importsCyclesProbe.stdout.trim());
    log(`queryCycles(rels=['imports'], maxDepth=15) on real graph: ${importsCyclesResult.ms.toFixed(1)}ms, members=${importsCyclesResult.count}`);
  } else {
    log(`queryCycles(rels=['imports']) probe: TIMED OUT or errored after 30000ms (status=${importsCyclesProbe.status}, signal=${importsCyclesProbe.signal})`);
  }

  return {
    hubId,
    cliRoundTrip: cliStats,
    inProcessQueryUp: upStats,
    queryDownDepthProbe: downDepthProbe,
    pathQuery: { from: fromNode, to: toNode, found: !!pathResult, depth: pathResult?.depth ?? null, probe: pathProbe },
    cyclesDefaultRelsMs: cyclesMs,
    cyclesDefaultRelsCount: cyclesReal.length,
    orphansMs,
    orphansCount: orphansReal.length,
    importsCyclesProbe: importsCyclesResult,
    importsCyclesProbeTimedOut: importsCyclesResult === null,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: impact correctness — independent oracle vs queryImpact
// ---------------------------------------------------------------------------

const SOURCE_ROOTS = ['lib', 'bin', 'scripts', 'tests'];
const RESOLVE_ORDER = ['', '.mjs', '.js', '.cjs', '.json', '/index.mjs', '/index.js'];
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Independent oracle: deliberately re-derives the forward import graph from
// scratch (its own walk + its own regex + its own resolver) rather than
// importing lib/graph/build-import-graph.mjs, so a bug shared by seeder and
// checker cannot hide. Only import-syntax coverage and directory list are
// shared assumptions with the seeder (both documented) — everything else is
// independently written.
function independentForwardImportGraph(rootDir) {
  const files = [];
  const skipDirs = new Set(['node_modules', '.git', '.construct', '.cx', 'dist', 'build', 'vendor', '.venv', '__pycache__']);
  function walk(dirRel) {
    const abs = path.join(rootDir, dirRel);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skipDirs.has(e.name)) continue;
      const rel = dirRel ? path.join(dirRel, e.name) : e.name;
      if (e.isDirectory()) { walk(rel); continue; }
      if (!e.isFile()) continue;
      if (['.mjs', '.js', '.cjs'].includes(path.extname(e.name)) || (dirRel === 'bin' && path.extname(e.name) === '')) files.push(rel);
    }
  }
  for (const root of SOURCE_ROOTS) walk(root);
  files.sort();

  function isTest(rel) { return rel.endsWith('.test.mjs') || rel.endsWith('.test.js'); }
  function idFor(rel) { return isTest(rel) ? `test:${rel}` : `file:${rel}`; }

  function resolveSpecifier(importerRel, spec) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
    const baseAbs = path.resolve(path.dirname(path.join(rootDir, importerRel)), spec);
    for (const suffix of RESOLVE_ORDER) {
      const cand = baseAbs + suffix;
      try { if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return path.relative(rootDir, cand).split(path.sep).join('/'); } catch { /* try next */ }
    }
    return null;
  }

  const forwardAdj = new Map(); // importer id -> Set(imported id)
  for (const rel of files) {
    let content;
    try { content = fs.readFileSync(path.join(rootDir, rel), 'utf8'); } catch { continue; }
    const fromId = idFor(rel);
    let m;
    IMPORT_RE.lastIndex = 0;
    const targets = new Set();
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      const resolved = resolveSpecifier(rel, spec);
      if (resolved && resolved !== rel) targets.add(idFor(resolved));
    }
    if (!forwardAdj.has(fromId)) forwardAdj.set(fromId, new Set());
    for (const t of targets) forwardAdj.get(fromId).add(t);
  }
  return forwardAdj;
}

function independentReverseImpact(forwardAdj, changedId, nodeTypePrefix) {
  // Reverse BFS: who (transitively) imports changedId.
  const reverseAdj = new Map();
  for (const [from, tos] of forwardAdj) {
    for (const to of tos) {
      if (!reverseAdj.has(to)) reverseAdj.set(to, new Set());
      reverseAdj.get(to).add(from);
    }
  }
  const seen = new Set();
  const stack = [changedId];
  while (stack.length) {
    const id = stack.pop();
    for (const dependent of reverseAdj.get(id) || []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      stack.push(dependent);
    }
  }
  return [...seen].filter((id) => id.startsWith(nodeTypePrefix)).sort();
}

async function phase3_impactCorrectness(sandbox) {
  log('\n=== Phase 3: impact correctness (independent oracle vs queryImpact) ===');
  const mods = await loadRelationalModules(sandbox);
  const { queries } = mods;

  // file:lib/config-dir.mjs is a real hub (148 importers per an earlier grep)
  // — queryImpact restricts the traversal to a single rel ('imports') but
  // still uses the shared no-cutoff default maxDepth=50, and a first attempt
  // at this candidate hung this harness for 90s+ with no result. Every call
  // below runs in its own hard-killed child process so a hang on a dense hub
  // cannot stall the harness; the result records timedOut explicitly instead
  // of silently omitting the candidate.
  const changedCandidates = ['file:lib/graph/normalize.mjs', 'file:lib/graph/relational/schema-version.mjs', 'file:lib/config-dir.mjs'];
  const oracleAdj = independentForwardImportGraph(REPO_ROOT);

  const perNode = [];
  for (const changedId of changedCandidates) {
    const oracleTests = independentReverseImpact(oracleAdj, changedId, 'test:');
    const child = spawnSync(process.execPath, ['-e', `
      process.env.CX_HOME_OVERRIDE = ${JSON.stringify(sandbox)};
      process.env.HOME = ${JSON.stringify(sandbox)};
      import('${pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/queries.mjs')).href}').then(({ queryImpact }) => {
        const t0 = process.hrtime.bigint();
        const rows = queryImpact(${JSON.stringify(REPO_ROOT)}, ${JSON.stringify(changedId)}, { impactRel: 'imports', nodeType: 'test' });
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        console.log(JSON.stringify({ ms, ids: rows.map((r) => r.id) }));
      });
    `], { encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' });

    if (child.status !== 0 || !child.stdout.trim()) {
      perNode.push({ changedId, oracleCount: oracleTests.length, storeCount: null, match: null, timedOut: true, ms: null });
      log(`${changedId}: oracle=${oracleTests.length} test(s), store=TIMED OUT/KILLED after 20000ms — queryImpact did not return`);
      continue;
    }
    const { ms, ids } = JSON.parse(child.stdout.trim());
    const storeTests = ids.sort();
    const oracleSet = new Set(oracleTests);
    const storeSet = new Set(storeTests);
    const missingFromStore = oracleTests.filter((id) => !storeSet.has(id));
    const extraInStore = storeTests.filter((id) => !oracleSet.has(id));
    const match = missingFromStore.length === 0 && extraInStore.length === 0;
    perNode.push({ changedId, oracleCount: oracleTests.length, storeCount: storeTests.length, match, missingFromStore, extraInStore, ms, timedOut: false });
    log(`${changedId}: oracle=${oracleTests.length} test(s), store=${storeTests.length} test(s) in ${ms.toFixed(1)}ms, match=${match}${match ? '' : ` (missing=${missingFromStore.length}, extra=${extraInStore.length})`}`);
  }

  const completed = perNode.filter((p) => !p.timedOut);
  return { perNode, allMatch: completed.length > 0 && completed.every((p) => p.match), timedOutCount: perNode.filter((p) => p.timedOut).length };
}

// ---------------------------------------------------------------------------
// Phase 4: incremental update timing (mutation sandbox)
// ---------------------------------------------------------------------------

async function phase4_incrementalUpdate(sandbox) {
  log('\n=== Phase 4: incremental update timing ===');
  const mods = await loadRelationalModules(sandbox);
  const { outbox } = mods;

  const N = 10;
  const updateTimes = [];
  for (let i = 0; i < N; i++) {
    outbox.enqueueOutboxEvent(REPO_ROOT, {
      eventType: 'node_upsert',
      payload: { id: `capability:spikeA-incremental-${i}`, type: 'capability', name: `spikeA incremental ${i}`, attrs: { probe: i } },
      origin: 'spike-a-harness',
      declared: true,
    });
    const r = runCLI(sandbox, ['graph', 'update', '--json']);
    if (r.status !== 0) throw new Error(`graph update failed: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    if (parsed.drain.applied !== 1) throw new Error(`expected 1 applied delta, got ${parsed.drain.applied}`);
    updateTimes.push(r.ms);
  }
  const updateStats = stats(updateTimes);
  log(`'graph update' (CLI round-trip) after enqueueing 1 node each x${N}: mean=${updateStats.mean.toFixed(1)}ms p95=${updateStats.p95.toFixed(1)}ms min=${updateStats.min.toFixed(1)}ms`);

  // No-op drain (idempotency check): nothing pending.
  const noop = runCLIJson(sandbox, ['graph', 'update', '--json']);
  const noopIsEmpty = noop.json.drain.applied === 0;
  log(`no-op 'graph update' (nothing pending): ${noop.ms.toFixed(1)}ms, applied=${noop.json.drain.applied}, trustIncremental=${noop.json.trust.trustIncremental}`);

  // Confirm the last-inserted node is actually queryable post-update.
  const check = runCLIJson(sandbox, ['graph', 'query', `capability:spikeA-incremental-${N - 1}`, '--json']);
  const found = check.json.found === true;
  log(`post-update query of capability:spikeA-incremental-${N - 1}: found=${found}`);

  return { updateStats, noopMs: noop.ms, noopApplied: noop.json.drain.applied, noopTrustIncremental: noop.json.trust.trustIncremental, lastNodeFound: found };
}

// ---------------------------------------------------------------------------
// Phase 5: cycle detection (real deliberate cycle injected into mutation sandbox)
// ---------------------------------------------------------------------------

async function phase5_cycleDetection(sandbox) {
  log('\n=== Phase 5: cycle detection (deliberate synthetic cycle) ===');
  const mods = await loadRelationalModules(sandbox);
  const { outbox } = mods;

  for (const id of ['capability:spikeA-cycle-a', 'workflow:spikeA-cycle-b']) {
    outbox.enqueueOutboxEvent(REPO_ROOT, { eventType: 'node_upsert', payload: { id, type: id.split(':')[0], name: id, attrs: {} }, origin: 'spike-a-harness', declared: true });
  }
  for (const [from, to] of [['capability:spikeA-cycle-a', 'workflow:spikeA-cycle-b'], ['workflow:spikeA-cycle-b', 'capability:spikeA-cycle-a']]) {
    outbox.enqueueOutboxEvent(REPO_ROOT, { eventType: 'edge_upsert', payload: { from, to, rel: 'embeds' }, origin: 'spike-a-harness', declared: true });
  }
  runCLI(sandbox, ['graph', 'update']);

  const cycles = runCLIJson(sandbox, ['graph', 'cycles', '--json']);
  const members = cycles.json.cycles.map((c) => c.cycle_member);
  const detected = members.includes('capability:spikeA-cycle-a') && members.includes('workflow:spikeA-cycle-b');
  log(`introduced 2-node cycle (capability:spikeA-cycle-a <-> workflow:spikeA-cycle-b via 'embeds'): detected=${detected}, total cycle members reported=${members.length}`);

  return { detected, totalCycleMembers: members.length };
}

// ---------------------------------------------------------------------------
// Phase 6: orphan detection (real deliberate orphan)
// ---------------------------------------------------------------------------

async function phase6_orphanDetection(sandbox) {
  log('\n=== Phase 6: orphan detection (deliberate synthetic orphan) ===');
  const mods = await loadRelationalModules(sandbox);
  const { outbox } = mods;

  outbox.enqueueOutboxEvent(REPO_ROOT, {
    eventType: 'node_upsert',
    payload: { id: 'capability:spikeA-orphan', type: 'capability', name: 'spikeA orphan', attrs: {} },
    origin: 'spike-a-harness',
    declared: true,
  });
  runCLI(sandbox, ['graph', 'update']);

  const orphans = runCLIJson(sandbox, ['graph', 'orphans', '--capabilities', '--json']);
  const detected = orphans.json.orphans.some((o) => o.id === 'capability:spikeA-orphan');
  log(`introduced orphan capability (no realizes/validates inbound edges): detected=${detected}, total orphaned capabilities=${orphans.json.count}`);

  return { detected, totalOrphanedCapabilities: orphans.json.count };
}

// ---------------------------------------------------------------------------
// Phase 7: reconciliation — drift detection + repair
// ---------------------------------------------------------------------------

async function phase7_reconciliation(sandbox) {
  log('\n=== Phase 7: reconciliation (drift detection + repair) ===');
  const mods = await loadRelationalModules(sandbox);
  const { outbox } = mods;

  // A manual-only node inserted with declared:false and no backing seeder —
  // a fresh rebuild will never reproduce it, so reconcile must flag+remove it.
  outbox.enqueueOutboxEvent(REPO_ROOT, {
    eventType: 'node_upsert',
    payload: { id: 'capability:spikeA-manual-only', type: 'capability', name: 'spikeA manual only', attrs: {} },
    origin: 'spike-a-harness',
    declared: false,
  });
  runCLI(sandbox, ['graph', 'update']);
  const before = runCLIJson(sandbox, ['graph', 'query', 'capability:spikeA-manual-only', '--json']);
  log(`before reconcile: capability:spikeA-manual-only found=${before.json.found}`);

  const t0 = process.hrtime.bigint();
  const reconciled = runCLIJson(sandbox, ['graph', 'reconcile', '--no-co-change', '--json']);
  const reconcileMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const driftDetected = reconciled.json.empty === false && reconciled.json.nodes.removed.includes('capability:spikeA-manual-only');
  log(`reconcile: empty=${reconciled.json.empty}, applied=${reconciled.json.applied}, nodes removed includes manual-only=${reconciled.json.nodes.removed.includes('capability:spikeA-manual-only')}, wall=${reconcileMs.toFixed(1)}ms (CLI-reported ${reconciled.ms.toFixed(1)}ms)`);
  log(`full drift summary: nodes +${reconciled.json.nodes.added.length}/-${reconciled.json.nodes.removed.length}/~${reconciled.json.nodes.changed.length}, edges +${reconciled.json.edges.added.length}/-${reconciled.json.edges.removed.length}/~${reconciled.json.edges.changed.length}`);

  const after = runCLI(sandbox, ['graph', 'query', 'capability:spikeA-manual-only', '--json']);
  const afterParsed = JSON.parse(after.stdout.slice(after.stdout.indexOf('{')));
  const removedAfterApply = afterParsed.found === false;
  log(`after reconcile: capability:spikeA-manual-only found=${afterParsed.found} (expected false)`);

  const reconciledAgain = runCLIJson(sandbox, ['graph', 'reconcile', '--no-co-change', '--json']);
  const secondReconcileEmpty = reconciledAgain.json.empty === true;
  log(`second reconcile (already consistent): empty=${reconciledAgain.json.empty} (expected true), ${reconciledAgain.ms.toFixed(1)}ms`);

  return {
    driftDetected,
    removedAfterApply,
    secondReconcileEmpty,
    reconcileMs: reconciled.ms,
    secondReconcileMs: reconciledAgain.ms,
    driftSummary: { nodes: reconciled.json.nodes, edges: reconciled.json.edges },
  };
}

// ---------------------------------------------------------------------------
// Phase 8: JSONL fallback code-path exercise (targetId branch — same
// functions the !sqliteAvailable() branch calls; see report for the caveat
// about not having a real Node <22.5 binary in this environment).
// ---------------------------------------------------------------------------

async function phase8_jsonlFallback(sandbox) {
  log('\n=== Phase 8: JSONL fallback code path (no Node <22.5 binary available — see caveat) ===');
  process.env.CX_HOME_OVERRIDE = sandbox;
  process.env.HOME = sandbox;
  const store = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/store.mjs')).href);
  const { sqliteAvailable } = await import(pathToFileURL(path.join(REPO_ROOT, 'lib/graph/relational/sqlite-db.mjs')).href);

  const sqliteAvail = sqliteAvailable();
  log(`sqliteAvailable() on this runtime (${process.version}): ${sqliteAvail}`);

  // store.mjs: `if (targetId || !sqliteAvailable()) return writeGraphJsonl(...)`
  // — targetId always takes the JSONL path regardless of sqliteAvailable(),
  // exercising the identical fallback functions a Node <22.5 host graph would use.
  const targetId = 'spikeA-fallback-probe';
  const testGraph = { nodes: [{ id: 'file:fallback-probe.mjs', type: 'file', name: 'fallback-probe.mjs', attrs: {} }], edges: [], generatedAt: new Date().toISOString(), sourceHash: 'probe' };
  const writeResult = store.writeGraph(REPO_ROOT, testGraph, { targetId });
  const loaded = store.loadGraph(REPO_ROOT, { targetId });
  const jsonlWorked = loaded.exists && loaded.nodes.has('file:fallback-probe.mjs');
  const dir = store.graphDir(REPO_ROOT, targetId);
  const filesWritten = fs.existsSync(path.join(dir, 'nodes.jsonl')) && fs.existsSync(path.join(dir, 'edges.jsonl')) && fs.existsSync(path.join(dir, 'meta.json'));
  log(`JSONL write/load round-trip via targetId branch: wrote ${writeResult.nodeCount} node(s), loaded back found=${jsonlWorked}, files on disk=${filesWritten}`);

  return {
    sqliteAvailableOnThisRuntime: sqliteAvail,
    nodeVersionsAvailableInEnv: 'v22.23.1 (fnm-managed) and v25.9.0 (system) — both >=22.5; no Node <22.5 binary found in this environment',
    jsonlFallbackFunctionsExercised: jsonlWorked && filesWritten,
    caveat: 'This exercises writeGraphJsonl/loadGraphJsonl via the targetId branch (same functions the !sqliteAvailable() branch calls, per lib/graph/store.mjs writeGraph/loadGraph), NOT a live run under an actual Node <22.5 process — no such binary was available to spawn in this environment.',
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const sandboxesToClean = [];
  try {
    const p1 = await phase1_coldBuild();
    sandboxesToClean.push(p1.sandbox);
    results.phases.coldBuildAndStorage = p1;

    results.phases.queryLatency = await phase2_queryLatency(p1.sandbox, p1);
    results.phases.impactCorrectness = await phase3_impactCorrectness(p1.sandbox);

    const mutationSandbox = freshSandbox('spikeA-mutate-');
    sandboxesToClean.push(mutationSandbox);
    const mutBuild = runCLIJson(mutationSandbox, ['graph', 'build', '--no-co-change', '--json']);
    log(`\n(mutation sandbox seeded: ${mutBuild.json.nodeCount} nodes, ${mutBuild.json.edgeCount} edges, build ${mutBuild.ms.toFixed(1)}ms)`);

    results.phases.incrementalUpdate = await phase4_incrementalUpdate(mutationSandbox);
    results.phases.cycleDetection = await phase5_cycleDetection(mutationSandbox);
    results.phases.orphanDetection = await phase6_orphanDetection(mutationSandbox);
    results.phases.reconciliation = await phase7_reconciliation(mutationSandbox);

    const fallbackSandbox = freshSandbox('spikeA-fallback-');
    sandboxesToClean.push(fallbackSandbox);
    results.phases.jsonlFallback = await phase8_jsonlFallback(fallbackSandbox);

    const outPath = path.join(HERE, 'results.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
    log(`\n=== Results written to ${outPath} ===`);
  } finally {
    for (const s of sandboxesToClean) rmDir(s);
  }
}

main().catch((err) => {
  console.error('SPIKE HARNESS FAILED:', err);
  process.exitCode = 1;
});
