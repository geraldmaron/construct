/**
 * tests/graph/staleness.test.mjs — per-source graph seed-hash staleness (LMCP-C6).
 *
 * Pins: GRAPH_SEED_FILES still lists the legacy flat seed set; a missing
 * graph reports present:false without throwing; hashSourceGroup recurses
 * into directories so an edit inside one moves the hash (the historical bug
 * — a flat-file hash on a directory path always hashed as "missing"); and
 * checkGraphStaleness names the specific source that drifted (touching
 * .construct/providers.json flips stale=true naming 'providerManifests'), clearing
 * again after a rebuild that re-hashes.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkGraphStaleness,
  computeSourceHashes,
  hashSourceGroup,
  GRAPH_SEED_FILES,
} from '../../lib/graph/staleness.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-staleness-'));
  tmpDirs.push(root);
  return root;
}

test('GRAPH_SEED_FILES lists registry contracts and workflow defs', () => {
  assert.ok(GRAPH_SEED_FILES.includes('registry/capabilities.json'));
  assert.ok(GRAPH_SEED_FILES.includes('registry'));
});

test('checkGraphStaleness reports absent graph without throwing', () => {
  const state = checkGraphStaleness('/tmp/construct-staleness-missing-graph');
  assert.equal(state.present, false);
  assert.equal(state.stale, false);
  assert.deepEqual(state.staleSources, []);
});

test('hashSourceGroup recurses into a directory — an edit inside moves the hash', () => {
  const root = freshRoot();
  const dir = path.join(root, 'seed-dir');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.json'), '{"v":1}');

  const before = hashSourceGroup(root, ['seed-dir']);
  fs.writeFileSync(path.join(dir, 'a.json'), '{"v":2}');
  const after1 = hashSourceGroup(root, ['seed-dir']);

  assert.notEqual(before, after1, 'editing a file inside a hashed directory must move the hash');
});

test('hashSourceGroup treats a missing path as a stable sentinel, not a throw', () => {
  const root = freshRoot();
  assert.doesNotThrow(() => hashSourceGroup(root, ['does/not/exist']));
});

test('computeSourceHashes returns a hash per named seed group', () => {
  const root = freshRoot();
  const hashes = computeSourceHashes(root);
  for (const name of ['registry', 'overlays', 'specialistsOrg', 'plugins', 'providerManifests', 'workflowManifests']) {
    assert.equal(typeof hashes[name], 'string', `${name} hash is a string`);
    assert.ok(hashes[name].length > 0);
  }
});

test('touching .construct/providers.json flips stale=true naming providerManifests; rebuild clears it', () => {
  const root = freshRoot();
  fs.mkdirSync(path.join(root, '.construct'), { recursive: true });

  const initialHashes = computeSourceHashes(root);
  writeGraph(root, { nodes: [{ id: 'workflow:w', type: 'workflow' }], edges: [], sourceHashes: initialHashes });

  const clean = checkGraphStaleness(root);
  assert.equal(clean.stale, false);
  assert.deepEqual(clean.staleSources, []);

  fs.writeFileSync(path.join(root, '.construct', 'providers.json'), JSON.stringify({ anthropic: { apiKey: 'test' } }));

  const dirty = checkGraphStaleness(root);
  assert.equal(dirty.stale, true);
  assert.ok(dirty.staleSources.includes('providerManifests'));
  assert.match(dirty.staleReason, /providerManifests/);

  const rebuiltHashes = computeSourceHashes(root);
  writeGraph(root, { nodes: [{ id: 'workflow:w', type: 'workflow' }], edges: [], sourceHashes: rebuiltHashes });

  const rebuilt = checkGraphStaleness(root);
  assert.equal(rebuilt.stale, false);
  assert.deepEqual(rebuilt.staleSources, []);
});

test('touching a file inside registry flips stale=true naming specialistsOrg', () => {
  const root = freshRoot();
  const orgDir = path.join(root, 'specialists', 'org', 'scopes');
  fs.mkdirSync(orgDir, { recursive: true });
  fs.writeFileSync(path.join(orgDir, 'probe.json'), '{"id":"probe"}');

  const initialHashes = computeSourceHashes(root);
  writeGraph(root, { nodes: [{ id: 'workflow:w', type: 'workflow' }], edges: [], sourceHashes: initialHashes });
  assert.equal(checkGraphStaleness(root).stale, false);

  fs.writeFileSync(path.join(orgDir, 'probe.json'), '{"id":"probe","changed":true}');

  const dirty = checkGraphStaleness(root);
  assert.equal(dirty.stale, true);
  assert.ok(dirty.staleSources.includes('specialistsOrg'));
});
