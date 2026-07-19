/**
 * tests/graph/evidence.test.mjs — runtime-evidence edges: traces linked to workflow nodes (LMCP-C9).
 *
 * Pins: a fixture orchestration run persisted at the machine-scoped state
 * root's `runtime/orchestration/runs/<runId>.json` (ADR-0066) produces a
 * `runtime-evidence:<runId> --evidenced_by--> workflow:<type>` edge via
 * buildRuntimeEvidence; a run still `planned`/`running` (no terminal outcome
 * yet) or with no resolvable workflow type is skipped rather than fabricated
 * onto a node; latestEvidenceByWorkflow/checkExecutionStaleness reduce to one
 * last-execution summary per workflow type, picking the most recent
 * timestamp across repeated runs; `graph explain` surfaces that last-execution
 * data over both --json and human output; and a workflow with zero runtime
 * evidence is flagged `neverExecuted: true` distinctly from a workflow whose
 * evidence has merely aged past its staleness threshold (`stale: true`).
 *
 * CONSTRUCT_HOME_OVERRIDE is pinned for the whole file since runtime-evidence reads
 * resolve through the machine-scoped state root, keeping them off the real
 * developer machine's $HOME.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeGraph, loadGraph, nodeId } from '../../lib/graph/store.mjs';
import {
  buildRuntimeEvidence,
  latestEvidenceByWorkflow,
  computeLastExecutionByWorkflow,
  readRunRecords,
} from '../../lib/graph/runtime-evidence.mjs';
import { checkExecutionStaleness, EXECUTION_STALENESS_DEFAULT_THRESHOLD_DAYS } from '../../lib/graph/staleness.mjs';
import { runGraphCli } from '../../lib/graph/cli.mjs';
import { listWorkflowDefs } from '../../lib/embedded-contract/workflow-defs.mjs';
import { runtimeDir } from '../../lib/orchestration/run-store.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-evidence-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-evidence-'));
  tmpDirs.push(root);
  return root;
}

function runsDir(root) {
  const dir = path.join(runtimeDir(root), 'runs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A real embedded workflow type (not fabricated) so the fixture run maps
// onto a workflow node buildFromRegistry would itself emit.
const REAL_WORKFLOW_TYPE = listWorkflowDefs()[0].type;

function writeFixtureRun(root, overrides = {}) {
  const run = {
    runId: `run-fixture-${Math.random().toString(16).slice(2, 10)}`,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:05:00.000Z',
    request: { summary: 'fixture run', workflowType: REAL_WORKFLOW_TYPE },
    plan: { suggestedWorkflowType: null },
    tasks: [{ id: 't1', role: 'architect', status: 'done', executionState: 'executed' }],
    status: 'completed',
    executionState: 'executed',
    ...overrides,
  };
  fs.writeFileSync(path.join(runsDir(root), `${run.runId}.json`), JSON.stringify(run, null, 2));
  return run;
}

function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try { return { result: fn(), output: chunks.join('') }; }
  finally { process.stdout.write = original; }
}

test('readRunRecords returns [] when no runs directory exists', () => {
  const root = freshRoot();
  assert.deepEqual(readRunRecords(root), []);
});

test('a fixture orchestration run produces an evidenced_by edge', () => {
  const root = freshRoot();
  const run = writeFixtureRun(root);

  const evidence = buildRuntimeEvidence({ rootDir: root });
  assert.equal(evidence.nodes.length, 1);
  assert.equal(evidence.edges.length, 1);

  const [node] = evidence.nodes;
  assert.equal(node.type, 'runtime-evidence');
  assert.equal(node.id, nodeId('runtime-evidence', run.runId));
  assert.equal(node.attrs.workflowType, REAL_WORKFLOW_TYPE);
  assert.equal(node.attrs.outcome, 'executed');
  assert.equal(node.attrs.timestamp, run.updatedAt);

  const [edge] = evidence.edges;
  assert.equal(edge.from, nodeId('runtime-evidence', run.runId));
  assert.equal(edge.to, nodeId('workflow', REAL_WORKFLOW_TYPE));
  assert.equal(edge.rel, 'evidenced_by');
  assert.equal(edge.source, 'runtime-evidence');
});

test('the evidenced_by edge round-trips through the persisted graph store', () => {
  const root = freshRoot();
  writeFixtureRun(root);
  const evidence = buildRuntimeEvidence({ rootDir: root });

  writeGraph(root, {
    nodes: [{ id: nodeId('workflow', REAL_WORKFLOW_TYPE), type: 'workflow', name: REAL_WORKFLOW_TYPE }, ...evidence.nodes],
    edges: evidence.edges,
  });

  const graph = loadGraph(root);
  assert.equal(graph.meta.edgesByRel.evidenced_by, 1);
  const evidenceEdges = graph.edges.filter((e) => e.rel === 'evidenced_by');
  assert.equal(evidenceEdges[0].to, nodeId('workflow', REAL_WORKFLOW_TYPE));
});

test('a run with no resolvable workflow type is skipped, not fabricated', () => {
  const root = freshRoot();
  writeFixtureRun(root, { request: { summary: 'no workflow type' }, plan: {} });

  const evidence = buildRuntimeEvidence({ rootDir: root });
  assert.equal(evidence.nodes.length, 0);
  assert.equal(evidence.edges.length, 0);
  assert.equal(evidence.skippedRunIds.length, 1);
});

test('a still-running run is skipped until it reaches a terminal state', () => {
  const root = freshRoot();
  writeFixtureRun(root, { status: 'running', executionState: undefined, updatedAt: undefined });

  const evidence = buildRuntimeEvidence({ rootDir: root });
  assert.equal(evidence.nodes.length, 0);
  assert.equal(evidence.skippedRunIds.length, 1);
});

test('a corrupt run file is skipped rather than throwing', () => {
  const root = freshRoot();
  fs.writeFileSync(path.join(runsDir(root), 'run-broken.json'), '{ not valid json');
  writeFixtureRun(root);

  const evidence = buildRuntimeEvidence({ rootDir: root });
  assert.equal(evidence.nodes.length, 1);
});

test('latestEvidenceByWorkflow picks the most recent run across repeats', () => {
  const root = freshRoot();
  writeFixtureRun(root, { runId: 'run-older', updatedAt: '2026-05-01T00:00:00.000Z', executionState: 'executed' });
  writeFixtureRun(root, { runId: 'run-newer', updatedAt: '2026-06-15T00:00:00.000Z', executionState: 'degraded-executed' });

  const evidence = buildRuntimeEvidence({ rootDir: root });
  const byWorkflow = latestEvidenceByWorkflow(evidence);
  assert.equal(byWorkflow[REAL_WORKFLOW_TYPE].runId, 'run-newer');
  assert.equal(byWorkflow[REAL_WORKFLOW_TYPE].outcome, 'degraded-executed');

  // Every catalog workflow type is present in the map (even with no evidence),
  // so a caller can distinguish "no entry" bugs from "genuinely never executed".
  for (const wf of listWorkflowDefs()) {
    assert.ok(Object.prototype.hasOwnProperty.call(byWorkflow, wf.type), `${wf.type} present in map`);
  }
});

test('computeLastExecutionByWorkflow reads straight off disk', () => {
  const root = freshRoot();
  const run = writeFixtureRun(root);
  const byWorkflow = computeLastExecutionByWorkflow(root);
  assert.equal(byWorkflow[REAL_WORKFLOW_TYPE].runId, run.runId);
});

test('checkExecutionStaleness flags never-executed distinctly from stale', () => {
  const root = freshRoot();
  const staleTimestamp = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
  const otherType = listWorkflowDefs()[1].type;
  writeFixtureRun(root, { request: { summary: 'r', workflowType: otherType }, updatedAt: staleTimestamp });

  const state = checkExecutionStaleness(root);

  // REAL_WORKFLOW_TYPE has zero evidence anywhere in this fixture root.
  assert.equal(state.workflows[REAL_WORKFLOW_TYPE].neverExecuted, true);
  assert.equal(state.workflows[REAL_WORKFLOW_TYPE].stale, false);
  assert.ok(state.neverExecuted.includes(REAL_WORKFLOW_TYPE));
  assert.ok(!state.staleWorkflows.includes(REAL_WORKFLOW_TYPE));

  // otherType has evidence, but it is 200 days old — past the default 30-day
  // threshold — so it is stale, and explicitly NOT neverExecuted.
  assert.equal(state.workflows[otherType].neverExecuted, false);
  assert.equal(state.workflows[otherType].stale, true);
  assert.ok(state.staleWorkflows.includes(otherType));
  assert.ok(!state.neverExecuted.includes(otherType));
  assert.ok(state.workflows[otherType].ageDays > EXECUTION_STALENESS_DEFAULT_THRESHOLD_DAYS);
});

test('checkExecutionStaleness honors a per-workflow threshold override', () => {
  const root = freshRoot();
  const recentTimestamp = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  writeFixtureRun(root, { updatedAt: recentTimestamp });

  const lenient = checkExecutionStaleness(root, { thresholds: { [REAL_WORKFLOW_TYPE]: 30 } });
  assert.equal(lenient.workflows[REAL_WORKFLOW_TYPE].stale, false);

  const strict = checkExecutionStaleness(root, { thresholds: { [REAL_WORKFLOW_TYPE]: 1 } });
  assert.equal(strict.workflows[REAL_WORKFLOW_TYPE].stale, true);
});

test('graph explain --json shows last-execution data for an executed workflow', () => {
  const root = freshRoot();
  const run = writeFixtureRun(root);
  const evidence = buildRuntimeEvidence({ rootDir: root });
  writeGraph(root, {
    nodes: [{ id: nodeId('workflow', REAL_WORKFLOW_TYPE), type: 'workflow', name: REAL_WORKFLOW_TYPE }, ...evidence.nodes],
    edges: evidence.edges,
  });

  const { result: code, output } = captureStdout(() =>
    runGraphCli(['explain', REAL_WORKFLOW_TYPE, '--json'], { projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.id, nodeId('workflow', REAL_WORKFLOW_TYPE));
  assert.equal(parsed.execution.neverExecuted, false);
  assert.equal(parsed.execution.lastExecution.runId, run.runId);
  assert.equal(parsed.execution.lastExecution.timestamp, run.updatedAt);
  assert.equal(parsed.execution.lastExecution.outcome, 'executed');
});

test('graph explain (human output) shows last-execution data', () => {
  const root = freshRoot();
  const run = writeFixtureRun(root);
  const evidence = buildRuntimeEvidence({ rootDir: root });
  writeGraph(root, {
    nodes: [{ id: nodeId('workflow', REAL_WORKFLOW_TYPE), type: 'workflow', name: REAL_WORKFLOW_TYPE }, ...evidence.nodes],
    edges: evidence.edges,
  });

  const { result: code, output } = captureStdout(() =>
    runGraphCli(['explain', REAL_WORKFLOW_TYPE], { projectDir: root }));
  assert.equal(code, 0);
  assert.match(output, /last run/);
  assert.match(output, new RegExp(run.runId));
  assert.match(output, /outcome: executed/);
});

test('graph explain flags a never-executed workflow distinctly, not as stale', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [{ id: nodeId('workflow', REAL_WORKFLOW_TYPE), type: 'workflow', name: REAL_WORKFLOW_TYPE }],
    edges: [],
  });

  const { result: code, output } = captureStdout(() =>
    runGraphCli(['explain', REAL_WORKFLOW_TYPE, '--json'], { projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.execution.neverExecuted, true);
  assert.equal(parsed.execution.stale, false);
  assert.equal(parsed.execution.lastExecution, null);

  const { output: humanOutput } = captureStdout(() =>
    runGraphCli(['explain', REAL_WORKFLOW_TYPE], { projectDir: root }));
  assert.match(humanOutput, /NEVER EXECUTED/);
});

test('graph explain on a missing graph exits 1', () => {
  const root = freshRoot();
  const { result: code } = captureStdout(() =>
    runGraphCli(['explain', REAL_WORKFLOW_TYPE, '--json'], { projectDir: root }));
  assert.equal(code, 1);
});

test('graph explain on an unknown workflow id exits 1', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [], edges: [] });
  const { result: code } = captureStdout(() =>
    runGraphCli(['explain', 'not-a-real-workflow', '--json'], { projectDir: root }));
  assert.equal(code, 1);
});

test('graph explain with no workflow id argument prints usage and exits 1', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [], edges: [] });
  const { result: code } = captureStdout(() => runGraphCli(['explain'], { projectDir: root }));
  assert.equal(code, 1);
});

test('graph build seeds runtime-evidence nodes/edges from the project run store', () => {
  const root = freshRoot();
  writeFixtureRun(root);
  const { result: code } = captureStdout(() =>
    runGraphCli(['build', '--no-co-change', '--json'], { rootDir: process.cwd(), projectDir: root }));
  assert.equal(code, 0);

  const graph = loadGraph(root);
  assert.ok((graph.meta.edgesByRel.evidenced_by || 0) >= 1);
  assert.ok((graph.meta.nodesByType['runtime-evidence'] || 0) >= 1);
});
