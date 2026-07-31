/**
 * tests/functional/graph-relational-store.functional.test.mjs — day-one
 * milestone proof for the relational graph store.
 *
 * Drives the real `construct` binary and the real lib/graph/relational/
 * modules against one isolated project sandbox, walking the exact 12-step
 * sequence directive §4.11 names: register nodes -> derive edges ->
 * incremental update -> query up/downstream -> detect deliberate cycle ->
 * detect orphaned capability -> impact report for a changed schema ->
 * identify affected tests/adapters -> block a simulated change omitting
 * required validation -> export JSON + human-readable diagram -> equivalent
 * results on SQLite and Postgres -> rebuild and reconcile against
 * incremental state. Tests run in file order and build on one shared
 * project/graph, matching the directive's framing of one continuous
 * walkthrough rather than 12 disconnected fixtures.
 *
 * Gates on sqliteAvailable() (node:sqlite, Node >=22.5): with an older
 * runtime a single passing test records the skip, matching
 * tests/orchestration-run-store-sqlite.test.mjs's established pattern —
 * every relational capability genuinely requires that runtime, so a skip
 * here is an honest structural gap, not a suppressed failure.
 *
 * Milestone 11 (SQLite/Postgres parity) here stays a structural portability
 * lint, not a live cross-backend proof: every exported query template is
 * free of backend-specific functions and every named parameter round-trips
 * through bindNamedParams. The spawned `construct` binary's graph storage
 * layer (queries.mjs's `run` helper, outbox.mjs, reconcile.mjs) is
 * synchronous and wired to node:sqlite only, with no backend-switching on
 * DATABASE_URL — a CLI-driven walkthrough against a live Postgres-backed
 * store needs that switch, a larger change than either b0nny.3's or
 * b0nny.21's scope (both explicitly exclude a store redesign).
 *
 * The live round-trip lives in tests/graph/relational-postgres-store.test.mjs,
 * gated on DATABASE_URL, proven for real against a Docker Postgres instance
 *. Its "query-template parity" suite runs the exact
 * recursive-CTE SQL text behind milestones 4-8 below (queryUp/queryDown/
 * cycles/orphans/orphaned-capabilities/owners/requirements/impact) against
 * live Postgres via bindNamedParams + sql.unsafe, on the same fixture also
 * loaded into SQLite, and asserts equal row sets — real evidence for the
 * query engine, not for a CLI-driven walkthrough on a Postgres-backed store.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');

if (!sqliteAvailable()) {
  test('relational graph store day-one milestones skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-b0nny3-home-'));
  const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-b0nny3-project-'));

  // The outbox/query modules below are also called in-process (not just
  // through the spawned CLI) — pin the parent process's own HOME so both
  // paths resolve the identical graph.db under SANDBOX_HOME, restoring on
  // teardown per the isolation contract.
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;

  test.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    rmTmpDir(SANDBOX_HOME);
    rmTmpDir(PROJECT);
  });

  function runConstruct(args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: PROJECT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
    });
  }

  function runConstructJson(args) {
    const res = runConstruct(args);
    assert.equal(res.status, 0, `${args.join(' ')} failed: ${res.stderr}`);
    return JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
  }

  // `graph query <id>` exits 1 on a not-found id (by design, so a shell
  // pipeline can branch on it) — this variant parses the JSON body without
  // asserting the exit code, for a "confirm absent" check before an
  // incremental update.
  function runConstructJsonAnyStatus(args) {
    const res = runConstruct(args);
    return JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
  }

  // Direct module imports for capabilities with no dedicated CLI verb yet
  // (outbox enqueue is a library primitive for a future bead-declaration
  // integration point, not a user-facing command) and for the impact query,
  // which is generic over node type (unlike the file-path-scoped `impacted`
  // CLI command) — on why `impact` needed its
  // own rel parameter rather than reusing `impacted`.
  const { enqueueOutboxEvent, drainOutbox } = await import('../../lib/graph/relational/outbox.mjs');
  const { queryImpact, QUERY_UP, QUERY_DOWN, QUERY_PATH, QUERY_CYCLES, QUERY_ORPHANS,
    QUERY_ORPHANED_CAPABILITIES, QUERY_OWNERS, QUERY_REQUIREMENTS, QUERY_IMPACT, QUERY_EXPLAIN,
    QUERY_EXPORT_EDGES } = await import('../../lib/graph/relational/queries.mjs');
  const { bindNamedParams } = await import('../../lib/graph/relational/postgres-store.mjs');

  // --- Milestones 1 + 2: register nodes, derive edges ("build") ---

  test('milestone 1+2: register nodes / derive edges — construct graph build', () => {
    const res = runConstruct(['graph', 'build', '--no-co-change', '--json']);
    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.ok);
    assert.ok(parsed.nodeCount > 0, 'nodes registered');
    assert.ok(parsed.edgeCount > 0, 'edges derived');
    assert.ok(parsed.meta.nodesByType.capability > 0, 'capability nodes present');
    assert.ok(parsed.meta.edgesByRel.embeds > 0, 'embeds edges derived');
  });

  // --- Milestone 3: incremental update ---

  test('milestone 3: incremental update — outbox enqueue + drain', () => {
    const before = runConstructJsonAnyStatus(['graph', 'query', 'capability:b0nny3-incremental-demo', '--json']);
    assert.equal(before.found, false, 'demo node absent before the incremental update');

    enqueueOutboxEvent(PROJECT, {
      eventType: 'node_upsert',
      payload: { id: 'capability:b0nny3-incremental-demo', type: 'capability', name: 'Incremental Demo', attrs: { criticality: 'P2' } },
      origin: 'functional-test',
      declared: true,
    });
    enqueueOutboxEvent(PROJECT, {
      eventType: 'edge_upsert',
      payload: { from: 'capability:b0nny3-incremental-demo', to: 'workflow:demo-run', rel: 'embeds' },
      origin: 'functional-test',
      declared: true,
    });
    enqueueOutboxEvent(PROJECT, {
      eventType: 'node_upsert',
      payload: { id: 'workflow:demo-run', type: 'workflow', name: 'demo-run', attrs: {} },
      origin: 'functional-test',
      declared: true,
    });

    const update1 = runConstructJson(['graph', 'update', '--json']);
    assert.equal(update1.drain.applied, 3, 'all three enqueued deltas applied');
    assert.equal(update1.drain.failed, 0);
    assert.equal(update1.drain.deadLettered, 0);

    const after = runConstructJson(['graph', 'query', 'capability:b0nny3-incremental-demo', '--json']);
    assert.equal(after.found, true, 'demo node present after the incremental update');
    assert.deepEqual(after.node.attrs, { criticality: 'P2' });
    assert.ok(after.dependencies.includes('workflow:demo-run'));

    // Idempotency: draining again with nothing pending is a no-op, and the
    // trust decision reports the incremental state as clean.
    const update2 = runConstructJson(['graph', 'update', '--json']);
    assert.equal(update2.drain.applied, 0);
    assert.equal(update2.trust.trustIncremental, true);
  });

  // --- Milestone 4: query up/downstream ---

  test('milestone 4: query up/downstream — dependencies and dependents', () => {
    const result = runConstructJson(['graph', 'query', 'capability:b0nny3-incremental-demo', '--json']);
    assert.ok(result.dependencies.includes('workflow:demo-run'), 'downstream dependency resolved');
    const reverse = runConstructJson(['graph', 'query', 'workflow:demo-run', '--json']);
    assert.ok(reverse.dependents.includes('capability:b0nny3-incremental-demo'), 'upstream dependent resolved');
  });

  // --- Milestone 5: detect a deliberate cycle ---

  test('milestone 5: detect a deliberate cycle among embeds edges', () => {
    for (const [from, to] of [['capability:b0nny3-cycle-a', 'workflow:b0nny3-cycle-b'], ['workflow:b0nny3-cycle-b', 'capability:b0nny3-cycle-a']]) {
      enqueueOutboxEvent(PROJECT, { eventType: 'edge_upsert', payload: { from, to, rel: 'embeds' }, origin: 'functional-test', declared: true });
    }
    for (const id of ['capability:b0nny3-cycle-a', 'workflow:b0nny3-cycle-b']) {
      enqueueOutboxEvent(PROJECT, { eventType: 'node_upsert', payload: { id, type: id.split(':')[0], name: id, attrs: {} }, origin: 'functional-test', declared: true });
    }
    runConstruct(['graph', 'update']);

    const cycles = runConstructJson(['graph', 'cycles', '--json']);
    const members = cycles.cycles.map((c) => c.cycle_member);
    assert.ok(members.includes('capability:b0nny3-cycle-a'), 'cycle-a detected as a cycle member');
    assert.ok(members.includes('workflow:b0nny3-cycle-b'), 'cycle-b detected as a cycle member');
  });

  // --- Milestone 6: detect an orphaned capability ---

  test('milestone 6: detect an orphaned capability', () => {
    enqueueOutboxEvent(PROJECT, {
      eventType: 'node_upsert',
      payload: { id: 'capability:b0nny3-orphan', type: 'capability', name: 'Orphan', attrs: {} },
      origin: 'functional-test',
      declared: true,
    });
    runConstruct(['graph', 'update']);

    const orphans = runConstructJson(['graph', 'orphans', '--capabilities', '--json']);
    assert.ok(orphans.orphans.some((o) => o.id === 'capability:b0nny3-orphan'), 'the untested/unimplemented capability is reported as orphaned');
  });

  // --- Milestone 7 + 8: impact report for a changed schema; affected tests/adapters ---

  test('milestone 7+8: impact report for a changed schema identifies affected tests and adapters', () => {
    // 'schema' is a target-ontology node type (graph-store-design.md §8.1,
    // "~23 target node types are genuinely NEW") with no live seeder yet:
    // the assertions below pin the store/query layer as generic over node
    // type, not a claim that a real seeder populates schema nodes today.
    enqueueOutboxEvent(PROJECT, { eventType: 'node_upsert', payload: { id: 'schema:b0nny3-order-schema', type: 'schema', name: 'order-schema', attrs: {} }, origin: 'functional-test', declared: true });
    enqueueOutboxEvent(PROJECT, { eventType: 'node_upsert', payload: { id: 'test:b0nny3-schema.test.mjs', type: 'test', name: 'b0nny3-schema.test.mjs', attrs: {} }, origin: 'functional-test', declared: true });
    // 'provider' is the existing vocabulary's adapter representative
    // (graph-store-design.md §8.1: "provider (1 of 4 adapter kinds)").
    enqueueOutboxEvent(PROJECT, { eventType: 'node_upsert', payload: { id: 'provider:b0nny3-order-adapter', type: 'provider', name: 'order-adapter', attrs: {} }, origin: 'functional-test', declared: true });
    enqueueOutboxEvent(PROJECT, { eventType: 'edge_upsert', payload: { from: 'test:b0nny3-schema.test.mjs', to: 'schema:b0nny3-order-schema', rel: 'imports' }, origin: 'functional-test', declared: true });
    enqueueOutboxEvent(PROJECT, { eventType: 'edge_upsert', payload: { from: 'provider:b0nny3-order-adapter', to: 'test:b0nny3-schema.test.mjs', rel: 'imports' }, origin: 'functional-test', declared: true });
    const drain = drainOutbox(PROJECT);
    assert.equal(drain.failed, 0);
    assert.equal(drain.deadLettered, 0);

    const affectedTests = queryImpact(PROJECT, 'schema:b0nny3-order-schema', { impactRel: 'imports', nodeType: 'test' });
    assert.ok(affectedTests.some((r) => r.id === 'test:b0nny3-schema.test.mjs'), 'the schema change reaches its importing test');

    const affectedAdapters = queryImpact(PROJECT, 'schema:b0nny3-order-schema', { impactRel: 'imports', nodeType: 'provider' });
    assert.ok(affectedAdapters.some((r) => r.id === 'provider:b0nny3-order-adapter'), 'the schema change transitively reaches the adapter importing the affected test');
  });

  // --- Milestone 9: block a simulated change omitting required validation ---

  test('milestone 9: graph validate --strict blocks a capability with zero validating tests', () => {
    enqueueOutboxEvent(PROJECT, {
      eventType: 'node_upsert',
      payload: { id: 'capability:b0nny3-untested', type: 'capability', name: 'Untested', attrs: {} },
      origin: 'functional-test',
      declared: true,
    });
    runConstruct(['graph', 'update']);

    const strict = runConstruct(['graph', 'validate', '--strict', '--json']);
    assert.equal(strict.status, 1, 'strict validate must fail while a capability has zero validating tests');
    const parsed = JSON.parse(strict.stdout);
    assert.ok(parsed.errors.some((e) => e.includes("capability 'capability:b0nny3-untested' has zero validating tests")));

    // Completing the missing validation clears the block.
    enqueueOutboxEvent(PROJECT, { eventType: 'node_upsert', payload: { id: 'test:b0nny3-untested.test.mjs', type: 'test', name: 'b0nny3-untested.test.mjs', attrs: {} }, origin: 'functional-test', declared: true });
    enqueueOutboxEvent(PROJECT, { eventType: 'edge_upsert', payload: { from: 'test:b0nny3-untested.test.mjs', to: 'capability:b0nny3-untested', rel: 'validates' }, origin: 'functional-test', declared: true });
    runConstruct(['graph', 'update']);
    const strictAfter = JSON.parse(runConstruct(['graph', 'validate', '--strict', '--json']).stdout);
    assert.ok(!strictAfter.errors.some((e) => e.includes("capability 'capability:b0nny3-untested'")), 'the gate clears once the required test exists');
  });

  // --- Milestone 10: export JSON + human-readable diagram ---

  test('milestone 10: export JSON + mermaid/DOT diagram', () => {
    const json = runConstruct(['graph', 'export', '--format=json']);
    assert.equal(json.status, 0);
    const parsed = JSON.parse(json.stdout);
    assert.ok(parsed.nodes.some((n) => n.id === 'capability:b0nny3-incremental-demo'));
    assert.ok(parsed.edges.some((e) => e.from === 'capability:b0nny3-incremental-demo' && e.rel === 'embeds'));

    const mermaid = runConstruct(['graph', 'export', '--format=mermaid']);
    assert.equal(mermaid.status, 0);
    assert.match(mermaid.stdout, /^graph TD/);
    assert.match(mermaid.stdout, /-->\|embeds\|/);

    const dot = runConstruct(['graph', 'export', '--format=dot']);
    assert.equal(dot.status, 0);
    assert.match(dot.stdout, /^digraph construct_graph \{/);
  });

  // --- Milestone 11: equivalent results on SQLite and Postgres (structural) ---

  test('milestone 11 (structural): every query template is portable and bindNamedParams round-trips all of them', () => {
    const templates = { QUERY_UP, QUERY_DOWN, QUERY_PATH, QUERY_CYCLES, QUERY_ORPHANS,
      QUERY_ORPHANED_CAPABILITIES, QUERY_OWNERS, QUERY_REQUIREMENTS, QUERY_IMPACT, QUERY_EXPLAIN,
      QUERY_EXPORT_EDGES };
    const forbidden = /\b(group_concat|string_agg|instr|strpos)\s*\(/i;
    for (const [name, sql] of Object.entries(templates)) {
      assert.ok(!forbidden.test(sql), `${name} must not use a backend-specific function`);
      const names = [...new Set([...sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => `:${m[1]}`))];
      const params = Object.fromEntries(names.map((n) => [n, `stub-${n}`]));
      const { text, values } = bindNamedParams(sql, params);
      assert.ok(!text.includes(':'), `${name} must have zero unbound named params after bindNamedParams`);
      assert.equal(values.length, names.length, `${name} produced one positional value per distinct named param`);
    }
  });

  // --- Milestone 12: rebuild and reconcile against incremental state ---

  test('milestone 12: rebuild and reconcile catches drift the incremental path could not have produced', () => {
    // capability:b0nny3-manual-only exists only via a direct outbox event with
    // no backing seeder — a fresh rebuild's seed set will never reproduce it,
    // so reconcile must report it removed and actually remove it.
    enqueueOutboxEvent(PROJECT, {
      eventType: 'node_upsert',
      payload: { id: 'capability:b0nny3-manual-only', type: 'capability', name: 'Manual Only', attrs: {} },
      origin: 'functional-test',
      declared: false,
    });
    runConstruct(['graph', 'update']);
    const before = runConstructJson(['graph', 'query', 'capability:b0nny3-manual-only', '--json']);
    assert.equal(before.found, true);

    const reconciled = runConstructJson(['graph', 'reconcile', '--no-co-change', '--json']);
    assert.equal(reconciled.empty, false, 'reconcile must detect the manual-only node as drift');
    assert.ok(reconciled.nodes.removed.includes('capability:b0nny3-manual-only'));
    assert.equal(reconciled.applied, true);

    const after = runConstructJsonAnyStatus(['graph', 'query', 'capability:b0nny3-manual-only', '--json']);
    assert.equal(after.found, false, 'the manual-only node is gone after reconciliation applies the diff');

    // Reconciling again against the now-consistent state reports an empty diff.
    const reconciledAgain = runConstructJson(['graph', 'reconcile', '--no-co-change', '--json']);
    assert.equal(reconciledAgain.empty, true, 'a second reconcile against already-consistent state finds no drift');
  });
}
