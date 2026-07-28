/**
 * lib/graph/runtime-evidence.mjs — runtime-evidence edges for workflow runs,
 * merge events, and release events (LMCP-C9, construct-4uxq0.11.12).
 *
 * The living graph has static edges only (registry, import-graph, co-change,
 * corpus-annotation) — a workflow can be green in every one of those and still
 * never have executed successfully. This module closes that gap by reading
 * persisted orchestration run records (`<stateRoot>/runtime/orchestration/runs/*.json`,
 * ADR-0066's machine-scoped location for the Mode-A filesystem run store
 * lib/orchestration/run-store.mjs writes to) read-only and mapping each run
 * that resolves to a workflow type onto a
 * `runtime-evidence:<runId> --evidenced_by--> procedure:<type>` edge, carrying
 * `{ timestamp, outcome }` on the runtime-evidence node's attrs. One node per
 * run (not one node per workflow) so repeated runs of the same workflow each
 * leave their own evidence rather than collapsing into a single edge whose
 * weight-summing (store.mjs normalizeEdges) would blur distinct timestamps.
 *
 * Merge and release collectors (construct-4uxq0.11.12) follow the same
 * one-node-per-event shape: `runtime-evidence:merge:<sha> --merged_in--> file`
 * and `runtime-evidence:release:<tag> --released_in--> capability|module`.
 *
 * Evidence edges target procedure: nodes — the same prefix buildFromRegistry
 * emits, so an edge always lands on a node that exists.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { nodeId } from './store.mjs';
import { listProcedureDefinitions } from '../embedded-contract/procedure-definitions.mjs';
import { runtimeDir } from '../orchestration/run-store.mjs';

function runsDir(rootDir) {
  return path.join(runtimeDir(rootDir), 'runs');
}

function gitAvailable(repoRoot) {
  const probe = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return probe.status === 0;
}

function gitLines(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

function normalizeRepoRel(repoRoot, filePath) {
  const rel = path.relative(repoRoot, path.resolve(repoRoot, filePath)).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return null;
  return rel;
}

function isTrackableGraphPath(rel) {
  return /^(?:lib|tests|bin|registry|schemas|templates)\//.test(rel);
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

function buildWorkflowExecutionEvidence({ rootDir }) {
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
    const workflowNodeId = nodeId('procedure', workflowType);

    nodes.push({
      id: evidenceId,
      type: 'runtime-evidence',
      name: run.runId,
      attrs: {
        kind: 'workflow-run',
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
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {string} [opts.mainRef='main']
 * @param {number} [opts.limit=40]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildMergeEvidence({ repoRoot, mainRef = 'main', limit = 40 }) {
  const nodes = [];
  const edges = [];
  if (!gitAvailable(repoRoot)) return { nodes, edges };

  const mergeLines = gitLines(repoRoot, [
    'log', mainRef, '--merges', `--max-count=${limit}`, '--format=%H|%cI',
  ]);

  for (const line of mergeLines) {
    const [commitSha, timestamp] = line.split('|');
    if (!commitSha) continue;
    const evidenceId = nodeId('runtime-evidence', `merge:${commitSha}`);
    nodes.push({
      id: evidenceId,
      type: 'runtime-evidence',
      name: `merge:${commitSha.slice(0, 12)}`,
      attrs: {
        kind: 'merge',
        commitSha,
        timestamp: timestamp || null,
      },
    });

    const files = gitLines(repoRoot, ['diff-tree', '-m', '--no-commit-id', '--name-only', '-r', commitSha]);
    for (const file of files) {
      const rel = normalizeRepoRel(repoRoot, file);
      if (!rel || !isTrackableGraphPath(rel)) continue;
      edges.push({
        from: evidenceId,
        to: nodeId('file', rel),
        rel: 'merged_in',
        source: 'runtime-evidence',
      });
    }
  }

  return { nodes, edges };
}

function parseVersionTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(tag);
  return match ? match[1] : null;
}

function releaseChangedFiles(repoRoot, tag) {
  let files = gitLines(repoRoot, ['diff', '--name-only', `${tag}^`, tag]);
  if (files.length === 0) {
    files = gitLines(repoRoot, ['show', '--name-only', '--pretty=format:', tag]);
  }
  return files;
}

function releaseTargetsForFile(rel) {
  const targets = [nodeId('file', rel)];
  if (rel.startsWith('lib/')) {
    const moduleKey = rel.replace(/^lib\//, '').replace(/\.mjs$/, '');
    targets.push(nodeId('module', moduleKey));
  }
  if (rel === 'registry/capabilities.json' || rel.startsWith('registry/capabilities')) {
    targets.push(nodeId('capability', 'registry/capabilities.json'));
  }
  return targets;
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {number} [opts.limit=20]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildReleaseEvidence({ repoRoot, limit = 20 }) {
  const nodes = [];
  const edges = [];
  if (!gitAvailable(repoRoot)) return { nodes, edges };

  const tags = gitLines(repoRoot, [
    'for-each-ref', 'refs/tags', '--sort=-creatordate',
    `--count=${limit}`, '--format=%(refname:short)|%(creatordate:iso8601)',
  ]);

  for (const line of tags) {
    const [tag, timestamp] = line.split('|');
    const version = parseVersionTag(tag);
    if (!version) continue;

    const evidenceId = nodeId('runtime-evidence', `release:${tag}`);
    nodes.push({
      id: evidenceId,
      type: 'runtime-evidence',
      name: `release:${tag}`,
      attrs: {
        kind: 'release',
        tag,
        version,
        timestamp: timestamp || null,
      },
    });

    const files = releaseChangedFiles(repoRoot, tag);
    const seenTargets = new Set();
    for (const file of files) {
      const rel = normalizeRepoRel(repoRoot, file);
      if (!rel || !isTrackableGraphPath(rel)) continue;
      for (const targetId of releaseTargetsForFile(rel)) {
        const key = `${evidenceId}|${targetId}`;
        if (seenTargets.has(key)) continue;
        seenTargets.add(key);
        edges.push({
          from: evidenceId,
          to: targetId,
          rel: 'released_in',
          source: 'runtime-evidence',
        });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Map persisted runs, merge commits, and release tags onto runtime-evidence
 * nodes and their feedback edges.
 *
 * @param {object} opts
 * @param {string} opts.rootDir — project root for orchestration run records.
 * @param {string} [opts.repoRoot=rootDir] — git repo root for merge/release history.
 * @param {boolean} [opts.includeMergeRelease=true]
 * @returns {{ nodes: object[], edges: object[], skippedRunIds: string[] }}
 */
export function buildRuntimeEvidence({ rootDir, repoRoot = rootDir, includeMergeRelease = true }) {
  const workflow = buildWorkflowExecutionEvidence({ rootDir });
  if (!includeMergeRelease) return workflow;

  const merge = buildMergeEvidence({ repoRoot });
  const release = buildReleaseEvidence({ repoRoot });
  return {
    nodes: [...workflow.nodes, ...merge.nodes, ...release.nodes],
    edges: [...workflow.edges, ...merge.edges, ...release.edges],
    skippedRunIds: workflow.skippedRunIds,
  };
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
  for (const procedure of listProcedureDefinitions()) {
    byWorkflow[procedure.id] = null;
  }
  for (const n of evidence.nodes) {
    if (n.type !== 'runtime-evidence') continue;
    if (n.attrs?.kind && n.attrs.kind !== 'workflow-run') continue;
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
  return latestEvidenceByWorkflow(buildRuntimeEvidence({ rootDir, includeMergeRelease: false }));
}
