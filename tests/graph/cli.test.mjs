/**
 * tests/graph/cli.test.mjs — `construct graph query --missing-tests` CLI wiring.
 *
 * Exercises runGraphCli directly (not the spawned binary) since the
 * subcommand under test never calls process.exit, unlike `validate`.
 * Pins: --json emits the gap-query shape, non-JSON mode lists both
 * capabilities and workflows sections, and a missing graph exits 1.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGraphCli } from '../../lib/graph/cli.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';

// construct-b0nny.3: the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir,
// ADR-0066) whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Pin CX_HOME_OVERRIDE so this suite never provisions state under
// the real developer machine's ~/.construct/projects/ (the isolation
// contract, tests/functional/README.md) — the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established.

const cxGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const cxGraphTestPrevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = cxGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(cxGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (cxGraphTestPrevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = cxGraphTestPrevHomeOverride;
});


const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-cli-'));
  tmpDirs.push(root);
  return root;
}

function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try { return { result: fn(), output: chunks.join('') }; }
  finally { process.stdout.write = original; }
}

test('query --missing-tests --json emits capabilities and workflows arrays', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:untested', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
    ],
    edges: [
      { from: 'capability:untested', to: 'workflow:w', rel: 'embeds', source: 'registry' },
    ],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['query', '--missing-tests', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.graphPresent, true);
  assert.deepEqual(parsed.capabilities, ['capability:untested']);
  assert.deepEqual(parsed.workflows, ['workflow:w']);
});

test('query --missing-tests without --json prints human-readable sections', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: 'capability:tested', type: 'capability' }, { id: 'test:tests/a.test.mjs', type: 'test' }],
    edges: [{ from: 'test:tests/a.test.mjs', to: 'capability:tested', rel: 'validates', source: 'registry' }],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['query', '--missing-tests'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  assert.match(output, /capabilities with zero validating tests \(0\):/);
  assert.match(output, /workflows with zero validated embedding capability \(0\):/);
});

test('query --missing-tests on a project with no graph exits 1', () => {
  const root = freshRoot();
  const { result: code } = captureStdout(() => runGraphCli(['query', '--missing-tests', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 1);
});

// construct-b0nny.12: `graph path` had zero prior test coverage anywhere in
// the suite even though it is a real CLI caller of queryPath, and queryPath's
// default rel filter now excludes 'imports' (see lib/graph/relational/
// queries.mjs's header). These pin that the CLI command still finds a
// default-rel (embeds) path, still finds an imports-only path once opted in
// via --rel, and reports "no path found" rather than hanging when a path
// only exists along a relation the default excludes.

test('graph path finds a default-rel (embeds) path without --rel', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:a', type: 'capability' },
      { id: 'workflow:b', type: 'workflow' },
    ],
    edges: [{ from: 'capability:a', to: 'workflow:b', rel: 'embeds', source: 'registry' }],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['path', 'capability:a', 'workflow:b', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.found, true);
  assert.equal(parsed.depth, 1);
});

test('graph path reports no path found for an imports-only chain without --rel', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'file:a', type: 'file' },
      { id: 'file:b', type: 'file' },
    ],
    edges: [{ from: 'file:a', to: 'file:b', rel: 'imports', source: 'import-graph' }],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['path', 'file:a', 'file:b', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 1);
  const parsed = JSON.parse(output);
  assert.equal(parsed.found, false);
});

test('graph path --rel imports finds an imports-only chain when explicitly opted into', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'file:a', type: 'file' },
      { id: 'file:b', type: 'file' },
    ],
    edges: [{ from: 'file:a', to: 'file:b', rel: 'imports', source: 'import-graph' }],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['path', 'file:a', 'file:b', '--rel', 'imports', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.found, true);
  assert.equal(parsed.depth, 1);
});
