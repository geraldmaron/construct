/**
 * lib/graph/runtime-evidence.mjs — runtime-evidence edges: traces linked to workflow nodes (LMCP-C9).
 *
 * The living graph has static edges only (registry, import-graph, co-change,
 * corpus-annotation) — a workflow can be green in every one of those and still
 * never have executed successfully. This module closes that gap by reading
 * persisted orchestration run records (`.cx/runtime/orchestration/runs/*.json`,
 * the Mode-A filesystem run store written by lib/orchestration/run-store.mjs)
 * read-only and mapping each run that resolves to a workflow type onto a
 * `runtime-evidence:<runId> --evidenced_by--> workflow:<type>` edge, carrying
 * `{ timestamp, outcome }` on the runtime-evidence node's attrs. One node per
 * run (not one node per workflow) so repeated runs of the same workflow each
 * leave their own evidence rather than collapsing into a single edge whose
 * weight-summing (store.mjs normalizeEdges) would blur distinct timestamps.
 *
 * A run's workflow type is `run.request.workflowType`, falling back to
 * `run.plan.suggestedWorkflowType` (the same fallback lib/orchestration/
 * run-store.mjs's listRuns already exposes) — a run with neither is not
 * attributable to a workflow node and is skipped, not fabricated onto one.
 * Outcome favors the F4-aggregated `run.executionState` (executed |
 * degraded-executed | prepared | failed) when present since it already
 * reconciles every task's signal; a legacy run with no executionState falls
 * back to a coarser mapping off `run.status`.
 *
 * `latestEvidenceByWorkflow` reduces the per-run nodes to one summary per
 * workflow type (most recent timestamp wins) — the shape `graph explain` and
 * the C6 execution-staleness dimension (staleness.mjs) both consume, so a
 * workflow's "last execution" is defined in exactly one place.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { nodeId } from './store.mjs';
import { listWorkflowDefs } from '../embedded-contract/workflow-defs.mjs';

const RUNS_REL_DIR = path.join('.cx', 'runtime', 'orchestration', 'runs');

function runsDir(rootDir) {
  return path.join(rootDir, RUNS_REL_DIR);
}

/**
 * Read every persisted run record. Read-only — this module never writes to
 * the orchestration run store. A corrupt run file is skipped, not fatal.
 *
 * @param {string} rootDir
 * @returns {object[]}
 */
export function readRunRecords(rootDir) {
  const dir = runsDir(rootDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
    } catch {
      /* a corrupt run file is skipped, not fatal to evidence collection */
    }
  }
  return out;
}

function resolveWorkflowType(run) {
  return run?.request?.workflowType || run?.plan?.suggestedWorkflowType || null;
}

// run.executionState (LMCP-F4) already reconciles every task's signal into
// one of executed | degraded-executed | prepared | failed; only a legacy run
// with no executionState falls back to the coarser run.status mapping.

const STATUS_TO_OUTCOME = {
  'completed': 'executed',
  'degraded': 'degraded-executed',
  'completed-prepare-only': 'prepared',
  'completed-with-failures': 'failed',
  'cancelled': 'failed',
  'error': 'failed',
};

function resolveOutcome(run) {
  if (run.executionState) return run.executionState;
  return STATUS_TO_OUTCOME[run.status] || null;
}

function resolveTimestamp(run) {
  return run.updatedAt || run.createdAt || null;
}

/**
 * Map every persisted run onto a runtime-evidence node + evidenced_by edge to
 * its workflow node, when the run resolves to a known workflow type and has
 * reached a terminal (non-planned, non-running) state.
 *
 * @param {object} opts
 * @param {string} opts.rootDir
 * @returns {{ nodes: object[], edges: object[], skippedRunIds: string[] }}
 */
export function buildRuntimeEvidence({ rootDir }) {
  const runs = readRunRecords(rootDir);
  const nodes = [];
  const edges = [];
  const skipped = [];

  for (const run of runs) {
    if (!run?.runId) continue;
    if (run.status === 'planned' || run.status === 'running') { skipped.push(run.runId); continue; }
    const workflowType = resolveWorkflowType(run);
    if (!workflowType) { skipped.push(run.runId); continue; }

    const timestamp = resolveTimestamp(run);
    const outcome = resolveOutcome(run);
    const evidenceId = nodeId('runtime-evidence', run.runId);
    const workflowNodeId = nodeId('workflow', workflowType);

    nodes.push({
      id: evidenceId,
      type: 'runtime-evidence',
      name: run.runId,
      attrs: {
        runId: run.runId,
        workflowType,
        timestamp,
        outcome,
        status: run.status,
        taskCount: Array.isArray(run.tasks) ? run.tasks.length : 0,
      },
    });
    edges.push({
      from: evidenceId,
      to: workflowNodeId,
      rel: 'evidenced_by',
      source: 'runtime-evidence',
    });
  }

  return { nodes, edges, skippedRunIds: skipped };
}

/**
 * Reduce per-run evidence nodes to one summary per workflow type: the most
 * recent timestamp wins. Workflow types with zero evidence are present with
 * `lastExecution: null` so a caller can distinguish never-executed from
 * merely-stale without a second pass over the graph.
 *
 * @param {{ nodes: object[] }} evidence — buildRuntimeEvidence() output.
 * @returns {Record<string, { timestamp: string, outcome: string, runId: string }|null>}
 */
export function latestEvidenceByWorkflow(evidence) {
  const byWorkflow = {};
  for (const wf of listWorkflowDefs()) {
    byWorkflow[wf.type] = null;
  }
  for (const n of evidence.nodes) {
    if (n.type !== 'runtime-evidence') continue;
    const { workflowType, timestamp, outcome, runId } = n.attrs || {};
    if (!workflowType || !timestamp) continue;
    const prev = byWorkflow[workflowType];
    if (!prev || String(timestamp) > String(prev.timestamp)) {
      byWorkflow[workflowType] = { timestamp, outcome, runId };
    }
  }
  return byWorkflow;
}

/**
 * Convenience: read runs directly off disk and reduce to per-workflow last
 * execution in one call, for callers (CLI, staleness) that don't need the
 * raw node/edge lists.
 *
 * @param {string} rootDir
 * @returns {Record<string, { timestamp: string, outcome: string, runId: string }|null>}
 */
export function computeLastExecutionByWorkflow(rootDir) {
  return latestEvidenceByWorkflow(buildRuntimeEvidence({ rootDir }));
}
