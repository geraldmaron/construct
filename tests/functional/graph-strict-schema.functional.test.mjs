/**
 * tests/functional/graph-strict-schema.functional.test.mjs —
 * strict node/edge schema validation, identity stability, and partial-graph
 * provenance in the living graph store (construct-4uxq0.11.6).
 *
 * Before this fix: lib/graph/store.mjs declared NODE_TYPES/EDGE_RELS but
 * normalizeNodes/normalizeEdges never checked membership against either set,
 * nothing checked that an edge carried provenance (`sources`), there was no
 * rename/alias/tombstone mechanism, and a seeder that threw partway through
 * `construct graph build` (a fixture rootDir with no specialists/org
 * directory makes lib/registry/loader.mjs's loadRegistry throw "Modular org
 * not found", called unguarded from buildFromRegistry) crashed the whole CLI
 * process with zero record of what had been collected — reproduced directly
 * against this repo's code before the fix landed.
 *
 * Multi-component (store + validate + build-from-registry + cli): a builder
 * throwing is caught by lib/graph/cli.mjs's `runBuild`, which marks the graph
 * `partial: true` via lib/graph/store.mjs's `writeGraph`, which
 * lib/graph/validate.mjs's `validateGraph` (and the real `construct graph
 * validate` CLI, spawned as the real binary here) then reports as a fail-loud
 * error unless `--allow-partial` is passed.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runGraphCli } from '../../lib/graph/cli.mjs';
import { writeGraph, loadGraph, renameNode, dependenciesOf, dependentsOf, nodeId } from '../../lib/graph/store.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function captureOutput(fn) {
  const out = [];
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { out.push(chunk); return true; };
  try {
    return { result: fn(), stdout: out.join('') };
  } finally {
    process.stdout.write = origOut;
  }
}

// A fixture rootDir with a registry/ dir but no specialists/org directory
// reproduces a real, currently-uncaught throw: lib/registry/assemble.mjs's
// assembleRegistry throws "Modular org not found" and buildFromRegistry
// calls it unguarded (via lib/registry/loader.mjs's loadRegistry) for its
// contracts-doc read, at a call site with no try/catch of its own.

function makeRootWithoutOrg(prefix) {
  const root = freshDir(prefix);
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry', 'capabilities.json'), JSON.stringify({ capabilities: [] }));
  return root;
}

test('a builder that throws partway through `graph build` marks the graph partial instead of crashing the CLI', () => {
  const root = makeRootWithoutOrg('cx-graph-partial-root-');
  const project = freshDir('cx-graph-partial-proj-');

  const blocked = captureOutput(() => runGraphCli(['build', '--json'], { rootDir: root, projectDir: project }));
  assert.equal(blocked.result, 1, 'a partial build exits non-zero without --allow-partial');
  const parsedBlocked = JSON.parse(blocked.stdout);
  assert.equal(parsedBlocked.ok, false);
  assert.equal(parsedBlocked.partial, true);
  assert.ok(
    parsedBlocked.partialReasons.some((r) => r.includes('buildFromRegistry threw') && r.includes('Modular org not found')),
    `expected a buildFromRegistry throw reason in ${JSON.stringify(parsedBlocked.partialReasons)}`,
  );

  const metaOnDisk = JSON.parse(fs.readFileSync(path.join(project, '.construct', 'graph', 'meta.json'), 'utf8'));
  assert.equal(metaOnDisk.partial, true, 'partial: true is durably persisted in meta.json, not just the CLI response');
  assert.ok(metaOnDisk.partialReasons.length > 0);

  // `construct graph validate` reads the same persisted graph and must agree
  // that it is not acceptable as-is — spawned as the real binary so the
  // process.exit(...) path in lib/graph/cli.mjs's runValidate is exercised
  // end to end, not just the inner validateGraph() function.
  const env = sterileSpawnEnv();
  const validateBlocked = spawnSync(process.execPath, [BIN, 'graph', 'validate', '--json'], {
    cwd: project, encoding: 'utf8', timeout: 60_000, env,
  });
  assert.notEqual(validateBlocked.status, 0, 'graph validate must also fail-loud on a partial graph');
  const validateBlockedResult = JSON.parse(validateBlocked.stdout);
  assert.ok(validateBlockedResult.errors.some((e) => e.includes('graph is partial')));

  // --allow-partial accepts the same persisted graph on both build and validate.
  const allowed = captureOutput(() => runGraphCli(['build', '--json', '--allow-partial'], { rootDir: root, projectDir: project }));
  assert.equal(allowed.result, 0, '--allow-partial accepts a partial build');
  assert.equal(JSON.parse(allowed.stdout).ok, true);

  const validateAllowed = spawnSync(process.execPath, [BIN, 'graph', 'validate', '--json', '--allow-partial'], {
    cwd: project, encoding: 'utf8', timeout: 60_000, env,
  });
  assert.equal(validateAllowed.status, 0, '--allow-partial accepts the same graph in graph validate too');
});

test('construct graph validate --strict reports an injected bad-type node and bad-rel edge, exiting non-zero', () => {
  const project = freshDir('cx-graph-schema-proj-');
  writeGraph(project, {
    nodes: [
      { id: nodeId('capability', 'a'), type: 'capability', name: 'a' },
      { id: 'flie:x', type: 'flie', name: 'x' },
    ],
    edges: [
      { from: nodeId('capability', 'a'), to: 'flie:x', rel: 'improts', source: 'registry' },
      { from: nodeId('capability', 'a'), to: nodeId('capability', 'a'), rel: 'uses' },
    ],
  });

  const env = sterileSpawnEnv();
  const strict = spawnSync(process.execPath, [BIN, 'graph', 'validate', '--strict', '--json'], {
    cwd: project, encoding: 'utf8', timeout: 60_000, env,
  });
  assert.notEqual(strict.status, 0, 'a bad type/rel/provenance graph must exit non-zero under --strict');
  const parsed = JSON.parse(strict.stdout);
  assert.equal(parsed.valid, false);
  assert.ok(parsed.errors.some((e) => e.includes("unknown type 'flie'")));
  assert.ok(parsed.errors.some((e) => e.includes("unknown rel 'improts'")));
  assert.ok(parsed.errors.some((e) => e.includes('has no provenance (empty sources)')));

  // Lenient (non-strict) mode still surfaces the same facts as warnings, not
  // silence — schema drift is visible even before a team turns strict mode on.
  const lenient = spawnSync(process.execPath, [BIN, 'graph', 'validate', '--json'], {
    cwd: project, encoding: 'utf8', timeout: 60_000, env,
  });
  assert.equal(lenient.status, 0);
  const parsedLenient = JSON.parse(lenient.stdout);
  assert.ok(parsedLenient.warnings.some((w) => w.includes("unknown type 'flie'")));
});

test('renameNode preserves history through a real build+rename+query cycle: dependents resolve through the alias, the old id becomes a tombstone', () => {
  const project = freshDir('cx-graph-rename-proj-');
  writeGraph(project, {
    nodes: [
      { id: nodeId('capability', 'legacy-name'), type: 'capability', name: 'legacy-name' },
      { id: nodeId('workflow', 'w'), type: 'workflow', name: 'w' },
      { id: nodeId('test', 't'), type: 'test', name: 't' },
    ],
    edges: [
      { from: nodeId('capability', 'legacy-name'), to: nodeId('workflow', 'w'), rel: 'embeds', source: 'registry' },
      { from: nodeId('test', 't'), to: nodeId('capability', 'legacy-name'), rel: 'validates', source: 'registry' },
    ],
  });

  const oldId = nodeId('capability', 'legacy-name');
  const newId = nodeId('capability', 'current-name');
  renameNode(project, oldId, newId);

  // Not a rename-then-read against the same in-memory graph — a fresh
  // loadGraph call proves the tombstone/alias round-trip through disk.
  const graph = loadGraph(project);
  assert.equal(graph.nodes.get(oldId).type, 'tombstone');
  assert.equal(graph.nodes.get(oldId).attrs.supersededBy, newId);
  assert.deepEqual(graph.nodes.get(newId).attrs.aliases, [oldId]);

  assert.deepEqual(dependenciesOf(graph, oldId, 'embeds'), [nodeId('workflow', 'w')], 'the pre-rename id still resolves to the live dependency, not an empty result');
  assert.deepEqual(dependentsOf(graph, oldId, 'validates'), [nodeId('test', 't')], 'the pre-rename id still resolves to the live dependent, not a 404');
});
