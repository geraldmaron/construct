/**
 * tests/oracle/synthesize-partial-evidence.test.mjs
 * Oracle synthesis refuses clean verdicts on partial or stale living graphs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { collectDependencyGraph } from '../../lib/oracle/read-model.mjs';
import { routeGap } from '../../lib/oracle/routing.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sqliteAvailable } from '../../lib/graph/relational/sqlite-db.mjs';

function minimalReadModel(overrides = {}) {
  return {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, workerProfiles: {} },
    alignmentCensus: { present: true, stale: false, generatedAt: new Date().toISOString(), audit: { findingsCount: 0, regressions: [] }, skills: { trueOrphanCount: 0 } },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    projectDir: '/tmp',
    dependencyGraph: { present: false },
    ...overrides,
  };
}

test('partial graph never yields a healthy verdict and always surfaces graph-partial', () => {
  const readModel = minimalReadModel({
    dependencyGraph: {
      present: true,
      partial: true,
      partialReasons: ['buildFromRegistry: modular org not found'],
      stale: false,
      coverage: { capabilitiesWithoutTest: [], capabilitiesWithoutImpl: [], workflowsUncovered: [], orphanFileCount: 0 },
      untested: [],
    },
  });

  const { verdict, gaps } = synthesizeVerdict(readModel);
  const partialGap = gaps.find((g) => g.id === 'graph-partial');

  assert.ok(partialGap, 'expected graph-partial gap');
  assert.equal(partialGap.severity, 'high');
  assert.equal(partialGap.signal, 'dependency-graph');
  assert.deepEqual(partialGap.partialReasons, ['buildFromRegistry: modular org not found']);
  assert.match(partialGap.detail, /Living graph is partial/);
  assert.notEqual(verdict, 'healthy');
  assert.equal(routeGap(partialGap).workerProfileId, 'engineer');
});

test('stale graph surfaces graph-stale at medium severity', () => {
  const readModel = minimalReadModel({
    dependencyGraph: {
      present: true,
      partial: false,
      stale: true,
      staleReason: 'source(s) changed since last build: registry',
      staleSources: ['registry'],
      coverage: { capabilitiesWithoutTest: [], capabilitiesWithoutImpl: [], workflowsUncovered: [], orphanFileCount: 0 },
      untested: [],
    },
  });

  const { verdict, gaps } = synthesizeVerdict(readModel);
  const staleGap = gaps.find((g) => g.id === 'graph-stale');

  assert.ok(staleGap, 'expected graph-stale gap');
  assert.equal(staleGap.severity, 'medium');
  assert.deepEqual(staleGap.staleSources, ['registry']);
  assert.match(staleGap.detail, /Living graph is stale/);
  assert.notEqual(verdict, 'healthy');
});

test('fresh non-partial graph emits no graph-partial or graph-stale gaps', () => {
  const readModel = minimalReadModel({
    dependencyGraph: {
      present: true,
      partial: false,
      partialReasons: [],
      stale: false,
      staleReason: null,
      staleSources: [],
      coverage: { capabilitiesWithoutTest: [], capabilitiesWithoutImpl: [], workflowsUncovered: [], orphanFileCount: 0 },
      untested: [],
    },
  });

  const { gaps } = synthesizeVerdict(readModel);
  assert.equal(gaps.some((g) => g.id === 'graph-partial'), false);
  assert.equal(gaps.some((g) => g.id === 'graph-stale'), false);
});

test('collectDependencyGraph reads partial meta from a JSONL graph fixture', { skip: sqliteAvailable() }, () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-partial-graph-'));
  try {
    const graphDir = path.join(projectDir, '.construct', 'graph');
    fs.mkdirSync(graphDir, { recursive: true });
    fs.writeFileSync(
      path.join(graphDir, 'nodes.jsonl'),
      `${JSON.stringify({ id: 'capability:demo', type: 'capability', attrs: {} })}\n`,
    );
    fs.writeFileSync(path.join(graphDir, 'edges.jsonl'), '');
    fs.writeFileSync(
      path.join(graphDir, 'meta.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        sourceHash: 'fixturehash0000001',
        sourceHashes: {
          registry: 'fixturehash0000001',
          overlays: 'fixturehash0000001',
          workerProfiles: 'fixturehash0000001',
          plugins: 'fixturehash0000001',
          providerManifests: 'fixturehash0000001',
          workflowManifests: 'fixturehash0000001',
        },
        partial: true,
        partialReasons: ['seed step failed in test fixture'],
        nodeCount: 1,
        edgeCount: 0,
        nodesByType: { capability: 1 },
        edgesByRel: {},
      }, null, 2)}\n`,
    );

    const dg = collectDependencyGraph(projectDir, projectDir);
    assert.equal(dg.present, true);
    assert.equal(dg.partial, true);
    assert.deepEqual(dg.partialReasons, ['seed step failed in test fixture']);

    const { verdict, gaps } = synthesizeVerdict({
      projectDir,
      dependencyGraph: dg,
    });
    assert.ok(gaps.some((g) => g.id === 'graph-partial'));
    assert.notEqual(verdict, 'healthy');
  } finally {
    rmTmpDir(projectDir);
  }
});
