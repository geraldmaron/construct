/**
 * lib/graph/security-coverage.mjs — wire the adversarial/security test corpus
 * into the living graph and measure OWASP GenAI coverage (LMCP-N8).
 *
 * A security test disconnected from the Procedures it protects leaves coverage
 * unmeasurable. This module makes the linkage a first-class graph fact: a test
 * annotated `@owasp LLM01` (and optionally
 * `@secures <procedure-id>`) becomes a test node carrying its OWASP categories,
 * plus a `test --secures--> procedure` edge for each protected Procedure. The
 * coverage queries then read that structure back out of the graph — the matrix
 * and gap list are generated from the graph, never a hand-maintained sidecar.
 */

import { nodeId, loadGraph, nodesByType, dependentsOf } from './store.mjs';
import { extractSecurityTestEdges } from '../test-corpus-inventory.mjs';
import { loadEmbedCapabilities } from '../embed/capability-loader.mjs';

/** OWASP GenAI (LLM) Top 10, 2025 edition — the coverage rubric. */
export const OWASP_GENAI_TOP10 = Object.freeze([
  { id: 'LLM01', name: 'Prompt Injection' },
  { id: 'LLM02', name: 'Sensitive Information Disclosure' },
  { id: 'LLM03', name: 'Supply Chain' },
  { id: 'LLM04', name: 'Data and Model Poisoning' },
  { id: 'LLM05', name: 'Improper Output Handling' },
  { id: 'LLM06', name: 'Excessive Agency' },
  { id: 'LLM07', name: 'System Prompt Leakage' },
  { id: 'LLM08', name: 'Vector and Embedding Weaknesses' },
  { id: 'LLM09', name: 'Misinformation' },
  { id: 'LLM10', name: 'Unbounded Consumption' },
]);

/**
 * Seed security-test nodes + `secures` edges from `@owasp`/`@secures` tags.
 *
 * @param {{ rootDir: string }} opts
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildFromSecurity({ rootDir }) {
  const nodes = [];
  const edges = [];

  // A `@secures <id>` may name an executable Procedure or an embed preset; the
  // edge must point at whichever node actually exists, so resolve embed ids
  // (which live as `embed:<id>`, not `procedure:<id>`) up front.
  const embedIds = new Set(loadEmbedCapabilities({ rootDir }).capabilities.map((m) => m.id).filter(Boolean));

  for (const { testPath, owasp, secures } of extractSecurityTestEdges({ rootDir })) {
    const testId = nodeId('test', testPath);
    nodes.push({ id: testId, type: 'test', name: testPath, attrs: { path: testPath, exists: true, owasp } });
    for (const securedId of secures) {
      const to = embedIds.has(securedId) ? nodeId('embed', securedId) : nodeId('procedure', securedId);
      edges.push({ from: testId, to, rel: 'secures', source: 'corpus-annotation' });
    }
  }

  return { nodes, edges };
}

/** Every test node carrying at least one OWASP category, from the live graph. */
function securityTestNodes(graph) {
  return nodesByType(graph, 'test').filter((n) => Array.isArray(n.attrs?.owasp) && n.attrs.owasp.length > 0);
}

/**
 * OWASP coverage matrix generated from the graph: all 10 categories, each with
 * the count and paths of the tests tagged for it (0 for uncovered categories).
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, categories: Array<{ id, name, testCount, tests: string[] }>, uncovered: string[] }}
 */
export function buildOwaspMatrix(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, categories: [], uncovered: [] };

  const byCategory = new Map(OWASP_GENAI_TOP10.map((c) => [c.id, []]));
  for (const test of securityTestNodes(graph)) {
    for (const cat of test.attrs.owasp) {
      if (byCategory.has(cat)) byCategory.get(cat).push(test.attrs.path ?? test.name);
    }
  }

  const categories = OWASP_GENAI_TOP10.map(({ id, name }) => {
    const tests = [...byCategory.get(id)].sort();
    return { id, name, testCount: tests.length, tests };
  });

  return {
    graphPresent: true,
    categories,
    uncovered: categories.filter((c) => c.testCount === 0).map((c) => c.id),
  };
}

/**
 * Executable Procedures and embed presets with zero inbound `secures` edges —
 * the security-coverage gap list. Embed presets are included because they are
 * the highest-agency units (external reads + write proposals).
 *
 * @param {string} rootDir
 * @returns {{ graphPresent: boolean, procedures: string[], covered: string[] }}
 */
export function findProceduresMissingSecurity(rootDir) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) return { graphPresent: false, procedures: [], covered: [] };

  const missing = [];
  const covered = [];
  for (const node of [...nodesByType(graph, 'procedure'), ...nodesByType(graph, 'embed')]) {
    if (dependentsOf(graph, node.id, 'secures').length === 0) missing.push(node.id);
    else covered.push(node.id);
  }
  return { graphPresent: true, procedures: missing.sort(), covered: covered.sort() };
}
