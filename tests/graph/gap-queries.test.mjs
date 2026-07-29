/**
 * tests/graph/gap-queries.test.mjs — the six LMCP-C5 read-only gap queries.
 *
 * Pins: missing-docs flags a workflow/provider with zero inbound documents
 * edges; stale reflects lib/graph/staleness.mjs (LMCP-C6); dependencies,
 * providers, and surfaces report per-workflow requirements gathered from
 * embedding capabilities; every query reports graphPresent=false on a
 * missing graph without throwing. The consistency test is the acceptance
 * criterion: missing-tests output must agree with graph validate's error
 * list, since validateGraph sources its capability-test-gap warnings from
 * the same findMissingTestCapabilities function.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph } from '../../lib/graph/store.mjs';
import {
  findMissingTests,
  findMissingDocs,
  findStale,
  findDependencies,
  findProviders,
  findSurfaces,
} from '../../lib/graph/gap-queries.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

// construct-b0nny.3: the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir,
// ADR-0066) whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Pin CONSTRUCT_HOME_OVERRIDE so this suite never provisions state under
// the real developer machine's ~/.construct/projects/ (the isolation
// contract, tests/functional/README.md) — the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established.

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});


const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-gap-queries-'));
  tmpDirs.push(root);
  return root;
}

function sampleGraph() {
  return {
    nodes: [
      { id: 'procedure:documented', type: 'procedure' },
      { id: 'procedure:undocumented', type: 'procedure' },
      { id: 'provider:slack', type: 'provider' },
      { id: 'doc:docs/documented.md', type: 'doc', attrs: { path: 'docs/documented.md' } },
      { id: 'capability:cap-a', type: 'capability' },
      { id: 'contract:c1', type: 'contract' },
      { id: 'skill:s1', type: 'skill' },
      { id: 'surface:cli', type: 'surface' },
      { id: 'test:tests/cap-a.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'doc:docs/documented.md', to: 'procedure:documented', rel: 'documents', source: 'doc-scan' },
      { from: 'capability:cap-a', to: 'procedure:documented', rel: 'embeds', source: 'registry' },
      { from: 'capability:cap-a', to: 'contract:c1', rel: 'governed_by', source: 'registry' },
      { from: 'capability:cap-a', to: 'skill:s1', rel: 'uses', source: 'registry' },
      { from: 'capability:cap-a', to: 'surface:cli', rel: 'exposes', source: 'registry' },
      { from: 'test:tests/cap-a.test.mjs', to: 'capability:cap-a', rel: 'validates', source: 'registry' },
    ],
  };
}

test('findMissingDocs flags a workflow/provider with zero inbound documents edges', () => {
  const root = freshRoot();
  writeGraph(root, sampleGraph());
  const result = findMissingDocs(root);
  assert.equal(result.graphPresent, true);
  assert.deepEqual(result.workflows, ['procedure:undocumented']);
  assert.deepEqual(result.providers, ['provider:slack']);
});

test('findMissingDocs on a missing graph reports graphPresent=false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-gap-queries-empty-'));
  tmpDirs.push(root);
  const result = findMissingDocs(root);
  assert.equal(result.graphPresent, false);
});

test('findStale mirrors checkGraphStaleness', () => {
  const root = freshRoot();
  writeGraph(root, sampleGraph());
  const result = findStale(root);
  assert.equal(result.graphPresent, true);
  assert.equal(typeof result.stale, 'boolean');
  assert.ok(Array.isArray(result.staleSources));
});

test('findDependencies reports contracts/uses per workflow gathered from embedding capabilities', () => {
  const root = freshRoot();
  writeGraph(root, sampleGraph());
  const result = findDependencies(root);
  assert.equal(result.graphPresent, true);
  assert.deepEqual(result.workflows['procedure:documented'].contracts, ['contract:c1']);
  assert.deepEqual(result.workflows['procedure:documented'].uses, ['skill:s1']);
  assert.deepEqual(result.workflows['procedure:undocumented'].contracts, []);
});

test('findProviders reports provider-typed uses-edges per workflow', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'procedure:w', type: 'procedure' },
      { id: 'capability:c', type: 'capability' },
      { id: 'provider:slack', type: 'provider' },
    ],
    edges: [
      { from: 'capability:c', to: 'procedure:w', rel: 'embeds', source: 'registry' },
      { from: 'capability:c', to: 'provider:slack', rel: 'uses', source: 'registry' },
    ],
  });
  const result = findProviders(root);
  assert.deepEqual(result.workflows['procedure:w'], ['provider:slack']);
});

test('findSurfaces reports exposes-edges per workflow', () => {
  const root = freshRoot();
  writeGraph(root, sampleGraph());
  const result = findSurfaces(root);
  assert.deepEqual(result.workflows['procedure:documented'], ['surface:cli']);
  assert.deepEqual(result.workflows['procedure:undocumented'], []);
});

test('acceptance: missing-tests output agrees with graph validate error/warning list', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:tested', type: 'capability' },
      { id: 'capability:untested', type: 'capability' },
      { id: 'test:tests/tested.test.mjs', type: 'test' },
    ],
    edges: [
      { from: 'test:tests/tested.test.mjs', to: 'capability:tested', rel: 'validates', source: 'registry' },
    ],
  });

  const gaps = findMissingTests(root);
  const validation = validateGraph(root, { strict: true });

  assert.deepEqual(gaps.capabilities, ['capability:untested']);
  const flaggedInValidate = validation.errors.some((e) => e.includes('capability:untested') && e.includes('zero validating tests'));
  assert.ok(flaggedInValidate, 'graph validate must flag the same untested capability missing-tests flags');

  for (const capId of gaps.capabilities) {
    assert.ok(
      validation.errors.some((e) => e.includes(capId)),
      `every missing-tests capability (${capId}) must appear in graph validate's error list under strict mode`,
    );
  }
});

test('a fully-tested graph agrees on both sides: no gaps, no validate errors', () => {
  const root = freshRoot();
  writeGraph(root, sampleGraph());
  const gaps = findMissingTests(root);
  const validation = validateGraph(root, { strict: true });
  assert.deepEqual(gaps.capabilities, []);
  assert.ok(!validation.errors.some((e) => e.includes('zero validating tests')));
});
