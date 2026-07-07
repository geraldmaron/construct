/**
 * lib/graph/impacted.mjs — change-impact traversal for `construct graph impacted`.
 *
 * Given a set of changed repo-relative file paths, walks the living
 * dependency graph forward from each changed-file node through `imports`
 * (reverse — files/tests that import the changed file), `realizes`
 * (changed file → capability), `embeds` (capability → workflow), `validates`
 * (test → capability, reverse to find tests), and `documents` (doc → workflow
 * or provider, reverse to find docs) edges to answer: which workflows, tests,
 * and docs does this changeset touch. Scopes which checks a PR must run for a
 * CI drift gate. A changed path absent from the graph is reported in
 * `unknown` rather than raising — an unrecognized file (renamed, deleted,
 * generated, or simply not yet built into the graph) is common and must not
 * crash the traversal.
 */

import { loadGraph, dependenciesOf, dependentsOf } from './store.mjs';

function toFileNodeId(rel) {
  return rel.endsWith('.test.mjs') || rel.endsWith('.test.js') ? `test:${rel}` : `file:${rel}`;
}

function normalizeChangedPaths(changedFiles) {
  return [...new Set((changedFiles || []).map((f) => f.split('\\').join('/').replace(/^\.\//, '')))].filter(Boolean);
}

// Reverse-import closure: every file/test/module that transitively imports
// the changed node, so a leaf-file edit surfaces every consumer up the chain.

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

function stripPrefix(id) {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir — project root holding .construct/graph/.
 * @param {string[]} opts.changedFiles — repo-relative paths.
 * @returns {{
 *   graphPresent: boolean,
 *   changed: string[],
 *   unknown: string[],
 *   impactedWorkflows: string[],
 *   impactedTests: string[],
 *   impactedDocs: string[],
 *   impactedCapabilities: string[],
 * }}
 */
export function computeImpacted({ rootDir, changedFiles }) {
  const changed = normalizeChangedPaths(changedFiles);
  const graph = loadGraph(rootDir);

  if (!graph.exists) {
    return {
      graphPresent: false,
      changed,
      unknown: changed,
      impactedWorkflows: [],
      impactedTests: [],
      impactedDocs: [],
      impactedCapabilities: [],
    };
  }

  const unknown = [];
  const capabilities = new Set();
  const tests = new Set();
  const workflows = new Set();
  const docs = new Set();

  for (const rel of changed) {
    const id = toFileNodeId(rel);
    if (!graph.nodes.has(id)) { unknown.push(rel); continue; }

    if (id.startsWith('test:')) tests.add(id);

    for (const consumer of reverseImportClosure(graph, id)) {
      if (consumer.startsWith('test:')) tests.add(consumer);
    }

    for (const cap of dependenciesOf(graph, id, 'realizes')) capabilities.add(cap);
  }

  // A capability reached via realizes pulls in its validating tests and its
  // embedded workflow; a test reached via the import closure pulls in every
  // capability it validates, closing the loop in either direction.

  for (const cap of [...capabilities]) {
    for (const t of dependentsOf(graph, cap, 'validates')) tests.add(t);
    for (const wf of dependenciesOf(graph, cap, 'embeds')) workflows.add(wf);
  }
  for (const t of tests) {
    for (const cap of dependenciesOf(graph, t, 'validates')) {
      capabilities.add(cap);
      for (const wf of dependenciesOf(graph, cap, 'embeds')) workflows.add(wf);
    }
  }

  // Docs point at what they document (doc --documents--> workflow|provider),
  // so a doc is impacted when it documents a workflow already in scope.

  for (const wf of workflows) {
    for (const doc of dependentsOf(graph, wf, 'documents')) docs.add(doc);
  }

  return {
    graphPresent: true,
    changed,
    unknown: unknown.sort(),
    impactedWorkflows: [...workflows].map(stripPrefix).sort(),
    impactedTests: [...tests].map(stripPrefix).sort(),
    impactedDocs: [...docs].map(stripPrefix).sort(),
    impactedCapabilities: [...capabilities].map(stripPrefix).sort(),
  };
}
