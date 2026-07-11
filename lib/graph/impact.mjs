/**
 * lib/graph/impact.mjs — forward change-impact over the dependency graph.
 *
 * Given a set of changed files, computes the tests that should run, the
 * capabilities and workflows impacted, and any changed file that realizes no
 * capability (a coverage gap). Test selection is Test Impact Analysis over the
 * static import graph: a test is affected if it transitively imports a changed
 * file, or if it validates a capability that a changed file realizes. The
 * union is intentionally conservative — over-selection is safe, under-selection
 * silently ships untested change.
 */

import { loadGraph, dependentsOf, dependenciesOf } from './store.mjs';
import { rollupStaleImpact } from '../certification/stale-impact.mjs';

function isTestRel(rel) {
  return rel.endsWith('.test.mjs') || rel.endsWith('.test.js');
}

function toNodeId(rel) {
  return isTestRel(rel) ? `test:${rel}` : `file:${rel}`;
}

function reverseImportClosure(graph, startId) {
  const reached = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    for (const importer of dependentsOf(graph, id, 'imports')) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      stack.push(importer);
    }
  }
  return reached;
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir — project root holding .construct/graph/.
 * @param {string[]} opts.changedFiles — repo-relative paths.
 * @returns {{ changed: string[], unknown: string[], affectedTests: string[], impactedCapabilities: string[], impactedWorkflows: string[], staleCapabilities: string[], coverageGaps: string[], graphPresent: boolean }}
 */
export function computeImpact({ rootDir, changedFiles }) {
  const graph = loadGraph(rootDir);
  const norm = [...new Set((changedFiles || []).map((f) => f.split('\\').join('/').replace(/^\.\//, '')))].filter(Boolean);
  if (!graph.exists) {
    return {
      changed: norm,
      unknown: norm,
      affectedTests: [],
      impactedCapabilities: [],
      impactedWorkflows: [],
      staleCapabilities: rollupStaleImpact({ rootDir, changedFiles: norm }),
      coverageGaps: [],
      graphPresent: false,
    };
  }

  const tests = new Set();
  const capabilities = new Set();
  const unknown = [];
  const coverageGaps = [];

  for (const rel of norm) {
    const id = toNodeId(rel);
    if (!graph.nodes.has(id)) { unknown.push(rel); continue; }

    if (id.startsWith('test:')) tests.add(id);

    for (const importer of reverseImportClosure(graph, id)) {
      if (importer.startsWith('test:')) tests.add(importer);
    }

    const caps = dependenciesOf(graph, id, 'realizes');
    for (const c of caps) capabilities.add(c);
    if (id.startsWith('file:') && caps.length === 0) coverageGaps.push(rel);
  }

  // Capabilities reached transitively also pull in their declared verification
  // tests; their embedded workflows complete the requirement trace.

  for (const cap of [...capabilities]) {
    for (const t of dependentsOf(graph, cap, 'validates')) tests.add(t);
  }
  for (const t of tests) {
    for (const cap of dependenciesOf(graph, t, 'validates')) capabilities.add(cap);
  }

  const workflows = new Set();
  for (const cap of capabilities) {
    for (const wf of dependenciesOf(graph, cap, 'embeds')) workflows.add(wf);
  }

  const strip = (set, prefix) => [...set].map((id) => id.slice(prefix.length)).sort();
  const impactedCapabilityIds = strip(capabilities, 'capability:');
  const staleCapabilities = rollupStaleImpact({ rootDir, changedFiles: norm });
  return {
    changed: norm,
    unknown,
    affectedTests: [...tests].map((id) => id.slice('test:'.length)).sort(),
    impactedCapabilities: impactedCapabilityIds,
    impactedWorkflows: strip(workflows, 'workflow:'),
    staleCapabilities,
    coverageGaps: coverageGaps.sort(),
    graphPresent: true,
  };
}
