/**
 * lib/graph/build-co-change.mjs — co-change corroboration layer.
 *
 * Adds the third leg of hybrid population (after registry ingest and static
 * import derivation): module nodes for each source directory, `contains` edges
 * (module→file/test) that anchor those modules to the file graph, and
 * `co_changes` edges between directories that change together in git history.
 *
 * The git analysis reuses captureDependencyPatterns, which also records the
 * same directory relationships into the knowledge-graph entity store — so the
 * matrix and the entity graph share one co-change source of truth.
 */

import { captureDependencyPatterns } from '../artifact-capture.mjs';
import { nodeId } from './store.mjs';

function moduleOf(rel) {
  return rel.split('/').slice(0, 2).join('/');
}

function fileNodeId(rel) {
  return (rel.endsWith('.test.mjs') || rel.endsWith('.test.js')) ? `test:${rel}` : `file:${rel}`;
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir — repo whose git history and entity store are read/written.
 * @param {string[]} [opts.sourceRels] — repo-relative source paths to anchor under modules.
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildCoChange({ rootDir, sourceRels = [] }) {
  const nodes = [];
  const edges = [];
  const modules = new Set();

  for (const rel of sourceRels) {
    const mod = moduleOf(rel);
    modules.add(mod);
    edges.push({ from: nodeId('module', mod), to: fileNodeId(rel), rel: 'contains', source: 'import-graph' });
  }

  let pairs = [];
  try { pairs = captureDependencyPatterns(rootDir) || []; } catch { pairs = []; }
  for (const { a, b, count } of pairs) {
    modules.add(a);
    modules.add(b);
    const [from, to] = [a, b].sort();
    edges.push({ from: nodeId('module', from), to: nodeId('module', to), rel: 'co_changes', weight: count, source: 'co-change' });
  }

  for (const mod of modules) nodes.push({ id: nodeId('module', mod), type: 'module', name: mod, attrs: {} });

  return { nodes, edges };
}
