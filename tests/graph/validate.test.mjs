/**
 * tests/graph/validate.test.mjs — living-graph validation unit tests.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateGraph, nodeParts } from '../../lib/graph/validate.mjs';
import { writeGraph, nodeId } from '../../lib/graph/store.mjs';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-validate-'));
  tmpDirs.push(root);
  return root;
}

test('validate on empty/no-graph dir returns errors', () => {
  const root = freshRoot();
  const result = validateGraph(root);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['no graph found — run construct graph build first']);
});

test('validate on built graph returns valid', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('procedure', 'w1'), type: 'procedure', name: 'w1' },
      { id: nodeId('capability', 'c1'), type: 'capability', name: 'c1' },
    ],
    edges: [
      { from: nodeId('capability', 'c1'), to: nodeId('procedure', 'w1'), rel: 'embeds', source: 'registry' },
    ],
  });
  const result = validateGraph(root);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('doc node with non-existent file generates warning', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('doc', 'docs/missing.md'), type: 'doc', name: 'docs/missing.md', attrs: { path: 'docs/missing.md' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: false });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('docs/missing.md')));
});

test('doc node with non-existent file generates error in strict mode', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('doc', 'docs/missing.md'), type: 'doc', name: 'docs/missing.md', attrs: { path: 'docs/missing.md' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('docs/missing.md')));
});

test('doc node with existing file passes validation', () => {
  const root = freshRoot();
  const docDir = path.join(root, 'docs');
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(docDir, 'existing.md'), '# Existing doc');
  writeGraph(root, {
    nodes: [
      { id: nodeId('doc', 'docs/existing.md'), type: 'doc', name: 'docs/existing.md', attrs: { path: 'docs/existing.md' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('provider node with no manifest generates warning', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('provider', 'nonexistent-provider'), type: 'provider', name: 'nonexistent-provider', attrs: { id: 'nonexistent-provider' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: false });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('nonexistent-provider')));
});

test('provider node with no manifest generates error in strict mode', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('provider', 'nonexistent-provider'), type: 'provider', name: 'nonexistent-provider', attrs: { id: 'nonexistent-provider' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('nonexistent-provider')));
});

test('valid graph with real provider manifest passes strict', () => {
  const root = freshRoot();
  const manifestsDir = path.join(root, 'lib', 'extensions', 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'echo.manifest.json'), JSON.stringify({ id: 'echo', version: '1.0.0' }));
  writeGraph(root, {
    nodes: [
      { id: nodeId('provider', 'echo'), type: 'provider', name: 'echo', attrs: { id: 'echo' } },
    ],
    edges: [],
  });
  const result = validateGraph(root, { strict: true });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('doc node resolves against packageRoot when missing under project root', () => {
  const project = freshRoot();
  const packageRoot = freshRoot();
  const docDir = path.join(packageRoot, 'docs');
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(docDir, 'package-only.md'), '# Package doc');
  writeGraph(project, {
    nodes: [
      { id: nodeId('doc', 'docs/package-only.md'), type: 'doc', name: 'docs/package-only.md', attrs: { path: 'docs/package-only.md' } },
    ],
    edges: [],
  });
  const result = validateGraph(project, { strict: true, packageRoot });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('nodeParts extracts type and key from node id', () => {
  assert.deepEqual(nodeParts('workflow:test'), { type: 'workflow', key: 'test' });
  assert.deepEqual(nodeParts('provider:slack'), { type: 'provider', key: 'slack' });
  assert.deepEqual(nodeParts('doc:docs/readme.md'), { type: 'doc', key: 'docs/readme.md' });
  assert.deepEqual(nodeParts('no-colon'), { type: null, key: 'no-colon' });
});

test('deploymentMode option overrides detection', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: nodeId('provider', 'ghost'), type: 'provider', name: 'ghost', attrs: { id: 'ghost' } },
    ],
    edges: [],
  });
  const soloResult = validateGraph(root, { deploymentMode: 'solo' });
  assert.equal(soloResult.valid, true);
  assert.ok(soloResult.warnings.some(w => w.includes('ghost')));

  const strictResult = validateGraph(root, { deploymentMode: 'enterprise' });
  assert.equal(strictResult.valid, false);
  assert.ok(strictResult.errors.some(e => e.includes('ghost')));
});

// Workflow surface parity (LMCP-D4): validateGraph loads the real builtin
// manifests (loadAllWorkflows has no rootDir-scoped override for the
// embedded-contract workflows), so these assertions run against the
// committed lib/embedded-contract/workflows/*.manifest.json fixtures rather
// than a synthetic graph — a real declared/actual mismatch there would be a
// genuine authoring bug, so this doubles as the real-manifest regression
// guard for the rule.

test('graph validate surfaces zero surface-parity errors for the committed builtin manifests', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [], edges: [] });
  const result = validateGraph(root, { deploymentMode: 'solo' });
  const surfaceErrors = result.errors.filter((e) => e.includes('surface'));
  assert.deepEqual(surfaceErrors, []);
});

test('graph validate reports surface-parity errors regardless of deployment mode (never mode-gated)', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [], edges: [] });
  const soloResult = validateGraph(root, { deploymentMode: 'solo' });
  const strictResult = validateGraph(root, { deploymentMode: 'enterprise' });
  const soloSurfaceErrors = soloResult.errors.filter((e) => e.includes('surface'));
  const strictSurfaceErrors = strictResult.errors.filter((e) => e.includes('surface'));
  assert.deepEqual(soloSurfaceErrors, strictSurfaceErrors);
});
