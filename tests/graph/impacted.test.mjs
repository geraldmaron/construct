/**
 * tests/graph/impacted.test.mjs — change-impact traversal over a synthetic graph.
 *
 * Pins: a changed impl file surfaces its intake workflow (via realizes →
 * embeds) and its validating test (via validates), plus every test that
 * transitively imports it; a changed test file selects itself; an unknown
 * path is reported as unknown rather than crashing; a missing graph reports
 * graphPresent=false without throwing.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph } from '../../lib/graph/store.mjs';
import { computeImpacted } from '../../lib/graph/impacted.mjs';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-impacted-'));
  tmpDirs.push(root);
  return root;
}

function intakeFixtureGraph() {
  return {
    nodes: [
      { id: 'file:lib/intake/queue.mjs', type: 'file' },
      { id: 'file:lib/intake/prepare.mjs', type: 'file' },
      { id: 'test:tests/intake-queue.test.mjs', type: 'test' },
      { id: 'test:tests/intake-prepare.test.mjs', type: 'test' },
      { id: 'capability:intake.queue', type: 'capability' },
      { id: 'workflow:intake-classify', type: 'workflow' },
      { id: 'doc:docs/guides/intake/README.md', type: 'doc' },
    ],
    edges: [
      { from: 'file:lib/intake/prepare.mjs', to: 'file:lib/intake/queue.mjs', rel: 'imports', source: 'import-graph' },
      { from: 'test:tests/intake-prepare.test.mjs', to: 'file:lib/intake/prepare.mjs', rel: 'imports', source: 'import-graph' },
      { from: 'file:lib/intake/queue.mjs', to: 'capability:intake.queue', rel: 'realizes', source: 'registry' },
      { from: 'test:tests/intake-queue.test.mjs', to: 'capability:intake.queue', rel: 'validates', source: 'registry' },
      { from: 'capability:intake.queue', to: 'workflow:intake-classify', rel: 'embeds', source: 'registry' },
      { from: 'doc:docs/guides/intake/README.md', to: 'workflow:intake-classify', rel: 'documents', source: 'doc-scan' },
    ],
  };
}

test('impacted on lib/intake/queue.mjs lists the intake workflow and its tests', () => {
  const root = freshRoot();
  writeGraph(root, intakeFixtureGraph());
  const result = computeImpacted({ rootDir: root, changedFiles: ['lib/intake/queue.mjs'] });

  assert.equal(result.graphPresent, true);
  assert.deepEqual(result.unknown, []);
  assert.ok(result.impactedWorkflows.includes('intake-classify'));
  assert.ok(result.impactedTests.includes('tests/intake-queue.test.mjs'));
  assert.ok(result.impactedTests.includes('tests/intake-prepare.test.mjs'), 'transitive importer test is included');
  assert.ok(result.impactedDocs.includes('docs/guides/intake/README.md'));
  assert.ok(result.impactedCapabilities.includes('intake.queue'));
});

test('impacted on a changed test file selects itself', () => {
  const root = freshRoot();
  writeGraph(root, intakeFixtureGraph());
  const result = computeImpacted({ rootDir: root, changedFiles: ['tests/intake-queue.test.mjs'] });
  assert.ok(result.impactedTests.includes('tests/intake-queue.test.mjs'));
});

test('an unknown changed file is reported as unknown, not a crash', () => {
  const root = freshRoot();
  writeGraph(root, intakeFixtureGraph());
  const result = computeImpacted({ rootDir: root, changedFiles: ['lib/does/not/exist.mjs'] });
  assert.equal(result.graphPresent, true);
  assert.deepEqual(result.unknown, ['lib/does/not/exist.mjs']);
  assert.deepEqual(result.impactedWorkflows, []);
});

test('missing graph reports graphPresent=false without throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-impacted-empty-'));
  tmpDirs.push(root);
  const result = computeImpacted({ rootDir: root, changedFiles: ['lib/intake/queue.mjs'] });
  assert.equal(result.graphPresent, false);
  assert.deepEqual(result.unknown, ['lib/intake/queue.mjs']);
});

test('paths normalize leading ./ and backslashes and dedupe', () => {
  const root = freshRoot();
  writeGraph(root, intakeFixtureGraph());
  const result = computeImpacted({ rootDir: root, changedFiles: ['./lib/intake/queue.mjs', 'lib/intake/queue.mjs'] });
  assert.deepEqual(result.changed, ['lib/intake/queue.mjs']);
});
