/**
 * lib/oracle/impact-analysis.mjs — Layer 2 change-aware impact analysis.
 *
 * Given a working-tree diff, commit range, or explicit file list, walks the
 * three Layer 2 assurance edge types plus the living graph's validates/realizes
 * edges to surface changed contracts, coupled producers/consumers, invalidated
 * validation evidence, and untested impacted capabilities.
 */

import { spawnSync } from 'node:child_process';

import { LAYER2_EDGE_RELS } from '../graph/assurance-edges.mjs';
import { computeImpact } from '../graph/impact.mjs';
import { loadGraph, dependenciesOf, dependentsOf } from '../graph/store.mjs';

function normalizeRel(rel) {
  return String(rel || '').split('\\').join('/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function toFileNodeId(rel) {
  return rel.endsWith('.test.mjs') || rel.endsWith('.test.js') ? `test:${rel}` : `file:${rel}`;
}

function stripPrefix(id, prefix) {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function layer2Closure(graph, startIds, rels = LAYER2_EDGE_RELS) {
  const reached = new Set(startIds);
  const stack = [...startIds];
  while (stack.length) {
    const id = stack.pop();
    for (const rel of rels) {
      for (const downstream of dependenciesOf(graph, id, rel)) {
        if (reached.has(downstream)) continue;
        reached.add(downstream);
        stack.push(downstream);
      }
      for (const upstream of dependentsOf(graph, id, rel)) {
        if (reached.has(upstream)) continue;
        reached.add(upstream);
        stack.push(upstream);
      }
    }
  }
  return reached;
}

function collectLayer2Couplings(graph, changedNodeIds) {
  const couplings = [];
  for (const rel of LAYER2_EDGE_RELS) {
    for (const changedId of changedNodeIds) {
      for (const to of dependenciesOf(graph, changedId, rel)) {
        couplings.push({ rel, from: changedId, to, direction: 'forward' });
      }
      for (const from of dependentsOf(graph, changedId, rel)) {
        couplings.push({ rel, from, to: changedId, direction: 'reverse' });
      }
    }
  }
  return couplings;
}

function collectInvalidatedEvidence(graph, capabilityIds) {
  const tests = new Set();
  for (const capId of capabilityIds) {
    for (const testId of dependentsOf(graph, capId, 'validates')) tests.add(testId);
  }
  return [...tests].map((id) => stripPrefix(id, 'test:')).sort();
}

function collectChangedContracts(graph, changedNodeIds) {
  const contracts = new Set();
  for (const nodeId of changedNodeIds) {
    for (const contractId of dependenciesOf(graph, nodeId, 'governed_by')) contracts.add(contractId);
    for (const contractId of dependentsOf(graph, nodeId, 'governed_by')) contracts.add(contractId);
  }
  return [...contracts].map((id) => stripPrefix(id, 'contract:')).sort();
}

/**
 * Resolve changed repo-relative paths from explicit files or git.
 *
 * @param {string} projectDir
 * @param {{ files?: string[], base?: string, range?: string, mergeBase?: string }} [opts]
 * @returns {{ changed: string[], source: string, error?: string }}
 */
export function resolveChangedFiles(projectDir, { files, base, range, mergeBase } = {}) {
  if (files?.length) {
    return { changed: [...new Set(files.map(normalizeRel).filter(Boolean))], source: 'explicit' };
  }

  const gitArgs = ['diff', '--name-only'];
  if (range) {
    gitArgs.push(range);
  } else if (mergeBase) {
    gitArgs.push(`${mergeBase}...HEAD`);
  } else if (base) {
    gitArgs.push(base);
  } else {
    gitArgs.push('HEAD');
  }

  const res = spawnSync('git', gitArgs, { cwd: projectDir, encoding: 'utf8' });
  if (res.status !== 0) {
    return { changed: [], source: 'git', error: (res.stderr || res.stdout || 'git diff failed').trim() };
  }
  return {
    changed: res.stdout.split('\n').map(normalizeRel).filter(Boolean),
    source: range ? `git-range:${range}` : mergeBase ? `git-merge-base:${mergeBase}` : base ? `git-base:${base}` : 'git-working-tree',
  };
}

/**
 * @param {{ rootDir: string, changedFiles: string[], graph?: ReturnType<typeof loadGraph> }} opts
 */
export function computeChangeAwareImpact({ rootDir, changedFiles, graph = loadGraph(rootDir) }) {
  const changed = [...new Set((changedFiles || []).map(normalizeRel).filter(Boolean))];
  const baseImpact = computeImpact({ rootDir, changedFiles: changed });

  if (!graph.exists) {
    return {
      layer: 2,
      changed,
      graphPresent: false,
      resolutionError: null,
      changedContracts: [],
      layer2Couplings: [],
      coupledNodes: [],
      producers: [],
      consumers: [],
      invalidatedEvidence: [],
      untestedCapabilities: baseImpact.staleCapabilities,
      ...baseImpact,
    };
  }

  const changedNodeIds = changed.map(toFileNodeId).filter((id) => graph.nodes.has(id));
  const coupledClosure = layer2Closure(graph, changedNodeIds);
  const layer2Couplings = collectLayer2Couplings(graph, changedNodeIds);
  const capabilityIds = [...coupledClosure].filter((id) => id.startsWith('capability:'));
  for (const rel of changed) {
    const id = toFileNodeId(rel);
    for (const cap of dependenciesOf(graph, id, 'realizes')) capabilityIds.push(cap);
  }

  const uniqueCaps = [...new Set(capabilityIds)];
  const invalidatedEvidence = collectInvalidatedEvidence(graph, uniqueCaps);
  const untestedCapabilities = [...new Set([
    ...baseImpact.staleCapabilities,
    ...uniqueCaps.map((id) => stripPrefix(id, 'capability:')),
  ])].sort();

  const coupledNodes = [...coupledClosure]
    .filter((id) => id.startsWith('file:') || id.startsWith('test:'))
    .map((id) => stripPrefix(stripPrefix(id, 'file:'), 'test:'))
    .sort();

  const producers = layer2Couplings
    .filter((c) => c.direction === 'reverse')
    .map((c) => stripPrefix(c.from, 'file:'))
    .filter(Boolean);
  const consumers = layer2Couplings
    .filter((c) => c.direction === 'forward')
    .map((c) => stripPrefix(c.to, 'file:'))
    .filter(Boolean);

  return {
    layer: 2,
    changed,
    graphPresent: true,
    changedContracts: collectChangedContracts(graph, changedNodeIds),
    layer2Couplings,
    coupledNodes,
    producers: [...new Set(producers)].sort(),
    consumers: [...new Set(consumers)].sort(),
    invalidatedEvidence,
    untestedCapabilities,
    affectedTests: baseImpact.affectedTests,
    impactedCapabilities: baseImpact.impactedCapabilities,
    impactedWorkflows: baseImpact.impactedWorkflows,
    staleCapabilities: baseImpact.staleCapabilities,
    coverageGaps: baseImpact.coverageGaps,
    unknown: baseImpact.unknown,
  };
}
