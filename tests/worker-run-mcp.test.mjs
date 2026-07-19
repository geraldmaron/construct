/**
 * tests/worker-run-mcp.test.mjs
 *
 * Pins Tier 1 sub-bead 4: the worker_run MCP tool runs a bounded command,
 * optionally records evidence on a named task graph node, and emits the
 * worker.started / worker.completed / evidence.recorded trace events
 * correlated by traceId.
 *
 * Trace + worker-artifact writes resolve through the machine-scoped state
 * root (ADR-0066), so CONSTRUCT_HOME_OVERRIDE is pinned for the whole file to keep
 * them off the real developer machine's $HOME.
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { workerRun } from '../lib/mcp/tools/skills.mjs';
import { traceDir } from '../lib/worker/trace.mjs';
import { FilesystemTaskGraphStore } from '../lib/task-graph/store.mjs';
import { generateTaskGraphFromTriage } from '../lib/task-graph/generate.mjs';
import { classifyRdIntake } from '../lib/intake/classify.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-mcp-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

let projectRoot;
let originalCwd;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-worker-mcp-'));
  originalCwd = process.cwd();
  process.chdir(projectRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('workerRun MCP tool', () => {
  it('runs a bounded command and returns the job result', async () => {
    const r = await workerRun({ command: 'echo worker-run-validation' });
    assert.equal(r.status, 'passed');
    assert.equal(r.exitCode, 0);
    const stdout = fs.readFileSync(r.stdoutPath, 'utf8');
    assert.match(stdout, /worker-run-validation/);
  });

  it('reports failure with non-zero exitCode and no thrown error', async () => {
    const r = await workerRun({ command: 'exit 3' });
    assert.equal(r.status, 'failed');
    assert.equal(r.exitCode, 3);
  });

  it('enforces timeout and reports status=timeout', async () => {
    const r = await workerRun({ command: 'sleep 5', timeoutSeconds: 1 });
    assert.equal(r.status, 'timeout');
  });

  it('refuses to run when workspaceRef is outside allowedPaths', async () => {
    const r = await workerRun({
      command: 'echo nope',
      workspaceRef: '/etc',
      allowedPaths: [projectRoot],
    });
    assert.match(r.error, /outside allowedPaths/);
  });

  it('records evidence on the named task graph node when graphId + nodeId supplied', async () => {
    const triage = classifyRdIntake({
      sourcePath: '/inbox/test.md',
      extractedText: 'Stack trace bug on login redirect.',
    });
    const graph = generateTaskGraphFromTriage({ triage, project: 'demo' });
    new FilesystemTaskGraphStore(projectRoot).save(graph);

    const r = await workerRun({
      command: 'echo verified',
      graphId: graph.id,
      nodeId: graph.nodes[0].id,
      evidenceType: 'test-result',
    });
    assert.equal(r.status, 'passed');
    assert.ok(r.evidence, 'evidence record returned');
    assert.equal(r.evidence.taskId, graph.nodes[0].id);
    assert.equal(r.evidence.evidenceType, 'test-result');

    const persisted = new FilesystemTaskGraphStore(projectRoot).read(graph.id);
    assert.equal(persisted.nodes[0].evidence.length, 1);
    assert.equal(persisted.nodes[0].evidence[0].evidenceType, 'test-result');
  });

  it('emits worker.started / worker.completed / evidence.recorded trace events on the same traceId', async () => {
    const triage = classifyRdIntake({
      sourcePath: '/inbox/test.md',
      extractedText: 'Stack trace bug on login redirect.',
    });
    const graph = generateTaskGraphFromTriage({ triage, project: 'demo' });
    new FilesystemTaskGraphStore(projectRoot).save(graph);

    const traceId = 'trace-worker-validation-1';
    await workerRun({
      command: 'echo evidence-trace',
      graphId: graph.id,
      nodeId: graph.nodes[0].id,
      traceId,
    });

    const dir = traceDir(projectRoot);
    const files = fs.readdirSync(dir);
    const events = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').map(JSON.parse);
    const types = events.filter((e) => e.traceId === traceId).map((e) => e.eventType);
    assert.ok(types.includes('worker.started'), `expected worker.started, got ${types.join(',')}`);
    assert.ok(types.includes('worker.completed'));
    assert.ok(types.includes('evidence.recorded'));
  });

  it('returns the result without writing evidence when graphId/nodeId omitted', async () => {
    const r = await workerRun({ command: 'echo no-evidence-target' });
    assert.equal(r.status, 'passed');
    assert.equal(r.evidence, undefined);
  });
});
