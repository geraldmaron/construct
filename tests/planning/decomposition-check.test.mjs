/**
 * tests/planning/decomposition-check.test.mjs — graph-informed decomposition
 * check (construct-b0nny.23), generalizing spike C's proven independence
 * pattern (docs/notes/research/workspace-control-plane/synthesis/spike-c-
 * parallel-software-change.md).
 *
 * detectDependencyCycles is pure and tested with no graph. The other three
 * (checkDependencyResolution, checkIndependenceClaims, checkDecomposition)
 * exercise a real relational graph store built with the outbox
 * enqueue/drain primitives tests/functional/graph-relational-store.
 * functional.test.mjs also uses, so the checks run against real
 * queryDown/queryPath output, not a mock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectDependencyCycles, checkDependencyResolution, checkIndependenceClaims, checkDecomposition } from '../../lib/planning/decomposition-check.mjs';

// --- pure cycle detection: no graph, no I/O ---

test('detectDependencyCycles finds no cycle in a linear chain', () => {
  const decomposition = [
    { id: 'a', dependsOn: [] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  const result = detectDependencyCycles(decomposition);
  assert.equal(result.ok, true);
  assert.deepEqual(result.cycles, []);
});

test('detectDependencyCycles finds a direct two-node cycle', () => {
  const decomposition = [
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] },
  ];
  const result = detectDependencyCycles(decomposition);
  assert.equal(result.ok, false);
  assert.equal(result.cycles.length, 1);
  assert.ok(result.cycles[0].includes('a'));
  assert.ok(result.cycles[0].includes('b'));
});

test('detectDependencyCycles finds a three-node cycle', () => {
  const decomposition = [
    { id: 'a', dependsOn: ['c'] },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] },
  ];
  const result = detectDependencyCycles(decomposition);
  assert.equal(result.ok, false);
  assert.equal(result.cycles.length, 1);
});

test('detectDependencyCycles ignores a dependsOn id absent from the decomposition', () => {
  const decomposition = [{ id: 'a', dependsOn: ['ghost'] }];
  const result = detectDependencyCycles(decomposition);
  assert.equal(result.ok, true);
});

// --- graph-backed checks: real relational graph store ---

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');

if (!sqliteAvailable()) {
  test('decomposition-check graph-backed suite skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  const { enqueueOutboxEvent, drainOutbox } = await import('../../lib/graph/relational/outbox.mjs');

  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-decomp-home-'));
  const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-decomp-project-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = HOME;

  test.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    fs.rmSync(HOME, { recursive: true, force: true });
    fs.rmSync(PROJECT, { recursive: true, force: true });
  });

  function node(id, type) {
    return { eventType: 'node_upsert', payload: { id, type, name: id, attrs: {} }, origin: 'planning-test', declared: true };
  }
  function edge(from, to, rel) {
    return { eventType: 'edge_upsert', payload: { from, to, rel }, origin: 'planning-test', declared: true };
  }

  // Fixture: consumer.mjs imports both a.mjs and b.mjs (shared dependent —
  // an independence claim between the assignment touching a.mjs and the one
  // touching b.mjs must be falsified). c.mjs and d.mjs each have a disjoint
  // sole consumer (a genuinely independent pair). e.mjs imports f.mjs
  // directly (a declared dependency that DOES resolve in the graph). g.mjs
  // shares no edge with h.mjs at all (a declared dependency that does NOT
  // resolve).
  for (const ev of [
    node('file:consumer.mjs', 'file'), node('file:a.mjs', 'file'), node('file:b.mjs', 'file'),
    edge('file:consumer.mjs', 'file:a.mjs', 'imports'),
    edge('file:consumer.mjs', 'file:b.mjs', 'imports'),
    node('file:c.mjs', 'file'), node('file:c-consumer.mjs', 'file'),
    edge('file:c-consumer.mjs', 'file:c.mjs', 'imports'),
    node('file:d.mjs', 'file'), node('file:d-consumer.mjs', 'file'),
    edge('file:d-consumer.mjs', 'file:d.mjs', 'imports'),
    node('file:e.mjs', 'file'), node('file:f.mjs', 'file'),
    edge('file:e.mjs', 'file:f.mjs', 'imports'),
    node('file:g.mjs', 'file'), node('file:h.mjs', 'file'),
  ]) enqueueOutboxEvent(PROJECT, ev);
  const drain = drainOutbox(PROJECT);
  assert.equal(drain.failed, 0);
  assert.equal(drain.deadLettered, 0);

  test('checkIndependenceClaims falsifies a pair with a shared dependent', () => {
    const decomposition = [
      { id: 'touch-a', dependsOn: [], touches: ['file:a.mjs'] },
      { id: 'touch-b', dependsOn: [], touches: ['file:b.mjs'] },
    ];
    const result = checkIndependenceClaims(PROJECT, decomposition);
    assert.equal(result.ok, false);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].independent, false);
    assert.ok(result.pairs[0].sharedDependents.includes('file:consumer.mjs'));
  });

  test('checkIndependenceClaims confirms a pair with disjoint dependents', () => {
    const decomposition = [
      { id: 'touch-c', dependsOn: [], touches: ['file:c.mjs'] },
      { id: 'touch-d', dependsOn: [], touches: ['file:d.mjs'] },
    ];
    const result = checkIndependenceClaims(PROJECT, decomposition);
    assert.equal(result.ok, true);
    assert.equal(result.pairs[0].independent, true);
    assert.deepEqual(result.pairs[0].sharedDependents, []);
  });

  test('checkIndependenceClaims skips pairs with a declared dependsOn edge', () => {
    const decomposition = [
      { id: 'touch-a', dependsOn: ['touch-b'], touches: ['file:a.mjs'] },
      { id: 'touch-b', dependsOn: [], touches: ['file:b.mjs'] },
    ];
    const result = checkIndependenceClaims(PROJECT, decomposition);
    assert.equal(result.pairs.length, 0, 'a declared dependency is not an independence claim to verify');
  });

  test('checkIndependenceClaims falsifies a pair connected by a direct graph path even with no shared dependent', () => {
    const decomposition = [
      { id: 'touch-e', dependsOn: [], touches: ['file:e.mjs'] },
      { id: 'touch-f', dependsOn: [], touches: ['file:f.mjs'] },
    ];
    const result = checkIndependenceClaims(PROJECT, decomposition);
    assert.equal(result.ok, false);
    assert.ok(result.pairs[0].directPath, 'a hard dependency edge (e.mjs imports f.mjs) contradicts the independence claim');
  });

  test('checkDependencyResolution resolves a declared dependency backed by a real graph path', () => {
    const decomposition = [
      { id: 'touch-e', dependsOn: ['touch-f'], touches: ['file:e.mjs'] },
      { id: 'touch-f', dependsOn: [], touches: ['file:f.mjs'] },
    ];
    const result = checkDependencyResolution(PROJECT, decomposition);
    assert.equal(result.ok, true);
    assert.equal(result.edges[0].resolved, true);
    assert.equal(result.edges[0].evidence.to, 'file:f.mjs');
  });

  test('checkDependencyResolution flags a declared dependency with no graph path', () => {
    const decomposition = [
      { id: 'touch-g', dependsOn: ['touch-h'], touches: ['file:g.mjs'] },
      { id: 'touch-h', dependsOn: [], touches: ['file:h.mjs'] },
    ];
    const result = checkDependencyResolution(PROJECT, decomposition);
    assert.equal(result.ok, false);
    assert.equal(result.edges[0].resolved, false);
    assert.equal(result.edges[0].reason, 'no-graph-path');
  });

  test('checkDependencyResolution flags a declared dependency on an assignment with no touches', () => {
    const decomposition = [
      { id: 'touch-g', dependsOn: ['no-touches'], touches: ['file:g.mjs'] },
      { id: 'no-touches', dependsOn: [], touches: [] },
    ];
    const result = checkDependencyResolution(PROJECT, decomposition);
    assert.equal(result.edges[0].reason, 'no-touches');
  });

  test('checkDecomposition composes cycles + dependency resolution + independence into one report', () => {
    const workSpec = {
      decomposition: [
        { id: 'touch-a', dependsOn: [], touches: ['file:a.mjs'] },
        { id: 'touch-b', dependsOn: [], touches: ['file:b.mjs'] },
        { id: 'touch-e', dependsOn: ['touch-f'], touches: ['file:e.mjs'] },
        { id: 'touch-f', dependsOn: [], touches: ['file:f.mjs'] },
      ],
    };
    const report = checkDecomposition(PROJECT, workSpec);
    assert.equal(report.cycles.ok, true);
    assert.equal(report.dependencyResolution.ok, true);
    assert.equal(report.independence.ok, false, 'touch-a/touch-b share a dependent');
    assert.equal(report.ok, false);
    assert.ok(report.checkedAt);
  });
}
