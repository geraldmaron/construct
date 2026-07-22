/**
 * tests/functional/mcp-graph-tools.functional.test.mjs — MCP graph query tools.
 *
 * Proves graph_query, graph_impacted, and graph_explain self-register through
 * scanToolModules, appear in the call gateway enum, return the same payloads
 * as `construct graph` --json for an isolated fixture graph, and surface an
 * explicit no_graph error when no store exists.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanToolModules } from '../../lib/mcp/tool-registry.mjs';
import { graphQuery, graphImpacted, graphExplain } from '../../lib/mcp/tools/graph.tool.mjs';
import { runGraphCli } from '../../lib/graph/cli.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-graph-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});

const tmpDirs = [];
function freshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mcp-graph-proj-'));
  tmpDirs.push(dir);
  return dir;
}
test.after(() => { for (const d of tmpDirs) { try { rmTmpDir(d); } catch {} } });

function seedGraph(projectDir) {
  writeGraph(projectDir, {
    nodes: [
      { id: 'file:lib/a.mjs', type: 'file', name: 'lib/a.mjs' },
      { id: 'file:lib/b.mjs', type: 'file', name: 'lib/b.mjs' },
      { id: 'capability:workflow.w', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
      { id: 'test:t', type: 'test', name: 'tests/t.test.mjs' },
    ],
    edges: [
      { from: 'file:lib/b.mjs', to: 'file:lib/a.mjs', rel: 'imports', source: 'import-graph' },
      { from: 'capability:workflow.w', to: 'workflow:w', rel: 'embeds', source: 'registry' },
      { from: 'test:t', to: 'capability:workflow.w', rel: 'validates', source: 'registry' },
    ],
  });
}

function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try { return { result: fn(), output: chunks.join('') }; }
  finally { process.stdout.write = original; }
}

test('scanToolModules registers graph_query, graph_impacted, graph_explain', async () => {
  const { defs, handlers, errors } = await scanToolModules();
  assert.equal(errors.length, 0);
  for (const name of ['graph_query', 'graph_impacted', 'graph_explain']) {
    assert.ok(defs.some((d) => d.name === name), `${name} in TOOL_DEFS`);
    assert.ok(handlers.has(name), `${name} in TOOL_HANDLERS`);
    const def = defs.find((d) => d.name === name);
    assert.equal(def.safety.class, 'read');
  }
});

test('graph_query matches construct graph query --json for node id', async () => {
  const project = freshProject();
  seedGraph(project);
  const mcp = await graphQuery({ node_id: 'file:lib/a.mjs', root_dir: project });
  const { result: code, output } = captureStdout(() => runGraphCli(['query', 'file:lib/a.mjs', '--json'], { rootDir: project, projectDir: project }));
  assert.equal(code, 0);
  const cli = JSON.parse(output);
  assert.deepEqual(mcp, cli);
});

test('graph_impacted matches construct graph impacted --json', async () => {
  const project = freshProject();
  seedGraph(project);
  const changed = ['lib/a.mjs'];
  const mcp = await graphImpacted({ changed_files: changed, root_dir: project });
  const { result: code, output } = captureStdout(() => runGraphCli(['impacted', '--changed', ...changed, '--json'], { rootDir: project, projectDir: project }));
  assert.equal(code, 0);
  const cli = JSON.parse(output);
  assert.deepEqual(mcp, cli);
});

test('graph_explain matches construct graph explain --json', async () => {
  const project = freshProject();
  seedGraph(project);
  const mcp = await graphExplain({ procedure_id: 'w', root_dir: project });
  const { result: code, output } = captureStdout(() => runGraphCli(['explain', 'w', '--json'], { rootDir: project, projectDir: project }));
  assert.equal(code, 0);
  const cli = JSON.parse(output);
  assert.deepEqual(mcp, cli);
});

test('graph tools return explicit no_graph when store is absent', async () => {
  const project = freshProject();
  const query = await graphQuery({ node_id: 'file:x', root_dir: project });
  assert.equal(query.error, 'no_graph');
  const impacted = await graphImpacted({ changed_files: ['lib/x.mjs'], root_dir: project });
  assert.equal(impacted.error, 'no_graph');
  const explain = await graphExplain({ procedure_id: 'w', root_dir: project });
  assert.equal(explain.error, 'no_graph');
});

test('call gateway enum includes graph tools after server module load', async () => {
  const { dispatchToolByName } = await import('../../lib/mcp/server.mjs');
  const project = freshProject();
  seedGraph(project);
  const viaDispatch = await dispatchToolByName('graph_query', { node_id: 'file:lib/a.mjs', root_dir: project });
  assert.equal(viaDispatch.found, true);
});
