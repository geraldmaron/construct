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
