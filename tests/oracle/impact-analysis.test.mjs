/**
 * tests/oracle/impact-analysis.test.mjs — Layer 2 change-aware impact analysis
 * (lib/oracle/impact-analysis.mjs): git resolution helpers and graph traversal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveChangedFiles, computeChangeAwareImpact } from '../../lib/oracle/impact-analysis.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';

const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-layer2-home-'));
process.env.CONSTRUCT_HOME_OVERRIDE = sandboxHome;
process.env.HOME = sandboxHome;

function tempDir(prefix, t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test.after(() => {
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
  fs.rmSync(sandboxHome, { recursive: true, force: true });
});

test('resolveChangedFiles honors explicit file lists', () => {
  const resolved = resolveChangedFiles(process.cwd(), { files: ['lib/oracle/cli.mjs', './lib/graph/store.mjs'] });
  assert.equal(resolved.source, 'explicit');
  assert.deepEqual(resolved.changed, ['lib/oracle/cli.mjs', 'lib/graph/store.mjs']);
});

test('computeChangeAwareImpact traverses Layer 2 couplings from a changed writer', (t) => {
  const rootDir = tempDir('cx-layer2-impact-', t);
  writeGraph(rootDir, {
    nodes: [
      { id: 'file:lib/embed/daemon.mjs', type: 'file', name: 'lib/embed/daemon.mjs' },
      { id: 'file:lib/oracle/read-model.mjs', type: 'file', name: 'lib/oracle/read-model.mjs' },
      { id: 'file:lib/directives/due-tracker.mjs', type: 'file', name: 'lib/directives/due-tracker.mjs' },
      { id: 'capability:directives.run', type: 'capability', name: 'directives.run' },
      { id: 'test:tests/directives/run.test.mjs', type: 'test', name: 'tests/directives/run.test.mjs' },
    ],
    edges: [
      { from: 'file:lib/embed/daemon.mjs', to: 'file:lib/oracle/read-model.mjs', rel: 'couples_state', sources: ['assurance-edges'] },
      { from: 'file:lib/embed/daemon.mjs', to: 'file:lib/directives/due-tracker.mjs', rel: 'couples_state', sources: ['assurance-edges'] },
      { from: 'file:lib/embed/daemon.mjs', to: 'capability:directives.run', rel: 'realizes', sources: ['registry'] },
      { from: 'test:tests/directives/run.test.mjs', to: 'capability:directives.run', rel: 'validates', sources: ['registry'] },
    ],
    generatedAt: new Date().toISOString(),
  });

  const result = computeChangeAwareImpact({
    rootDir,
    changedFiles: ['lib/embed/daemon.mjs'],
  });

  assert.equal(result.graphPresent, true);
  assert.ok(result.consumers.includes('lib/oracle/read-model.mjs'));
  assert.ok(result.coupledNodes.includes('lib/oracle/read-model.mjs'));
  assert.ok(result.invalidatedEvidence.includes('tests/directives/run.test.mjs'));
  assert.ok(result.layer2Couplings.some((c) => c.rel === 'couples_state'));
});

test('computeChangeAwareImpact degrades when graph is absent', (t) => {
  const rootDir = tempDir('cx-layer2-no-graph-', t);
  const result = computeChangeAwareImpact({ rootDir, changedFiles: ['lib/oracle/cli.mjs'] });
  assert.equal(result.graphPresent, false);
  assert.deepEqual(result.layer2Couplings, []);
});
