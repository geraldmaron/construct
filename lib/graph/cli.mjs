/**
 * lib/graph/cli.mjs — `construct matrix` command surface.
 *
 * Subcommands:
 *   build        Regenerate the dependency graph from the registry seeds
 *                (and, once available, the static import graph) into
 *                <projectDir>/.cx/graph/.
 *   stat         Print node/edge counts by type and relation.
 *   query <id>   Print a node's dependencies and dependents.
 *
 * Seeds are read from the Construct package root (rootDir); the graph is
 * persisted under the active project (projectDir) so it travels with .cx/.
 */

import { buildFromRegistry } from './build-from-registry.mjs';
import { buildImportGraph } from './build-import-graph.mjs';
import { buildCoChange } from './build-co-change.mjs';
import { writeGraph, loadGraph, dependenciesOf, dependentsOf } from './store.mjs';

function isoNow() {
  return new Date().toISOString();
}

function runBuild({ rootDir, projectDir, json, coChange }) {
  const reg = buildFromRegistry({ rootDir });
  const validates = reg.edges.filter((e) => e.rel === 'validates');
  const imp = buildImportGraph({ rootDir, validates });
  const nodes = [...reg.nodes, ...imp.nodes];
  const edges = [...reg.edges, ...imp.edges];

  if (coChange) {
    const sourceRels = imp.nodes.filter((n) => n.type === 'file' || n.type === 'test').map((n) => n.name);
    const co = buildCoChange({ rootDir, sourceRels });
    nodes.push(...co.nodes);
    edges.push(...co.edges);
  }

  const sourceHash = reg.sourceHash;
  const result = writeGraph(projectDir, { nodes, edges, generatedAt: isoNow(), sourceHash });
  const meta = loadGraph(projectDir).meta;
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result, meta }, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`✓ graph built: ${result.nodeCount} nodes, ${result.edgeCount} edges → ${result.dir}\n`);
  process.stdout.write(`  nodes: ${JSON.stringify(meta.nodesByType)}\n`);
  process.stdout.write(`  edges: ${JSON.stringify(meta.edgesByRel)}\n`);
  return 0;
}

function runStat({ projectDir, json }) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct matrix build` first.\n');
    return 1;
  }
  if (json) {
    process.stdout.write(JSON.stringify(graph.meta, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`graph: ${graph.nodes.size} nodes, ${graph.edges.length} edges (generated ${graph.meta?.generatedAt ?? 'unknown'})\n`);
  process.stdout.write(`  nodes: ${JSON.stringify(graph.meta?.nodesByType ?? {})}\n`);
  process.stdout.write(`  edges: ${JSON.stringify(graph.meta?.edgesByRel ?? {})}\n`);
  return 0;
}

function runQuery({ projectDir, id, json }) {
  const graph = loadGraph(projectDir);
  if (!graph.exists) {
    process.stderr.write('No graph found. Run `construct matrix build` first.\n');
    return 1;
  }
  const node = graph.nodes.get(id);
  const deps = dependenciesOf(graph, id);
  const dependents = dependentsOf(graph, id);
  if (json) {
    process.stdout.write(JSON.stringify({ id, found: !!node, node: node ?? null, dependencies: deps, dependents }, null, 2) + '\n');
    return node ? 0 : 1;
  }
  if (!node) {
    process.stderr.write(`node not found: ${id}\n`);
    return 1;
  }
  process.stdout.write(`${id} (${node.type})\n`);
  process.stdout.write(`  → dependencies (${deps.length}): ${deps.join(', ') || '(none)'}\n`);
  process.stdout.write(`  ← dependents   (${dependents.length}): ${dependents.join(', ') || '(none)'}\n`);
  return 0;
}

/**
 * @param {string[]} args
 * @param {{ rootDir: string, projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runGraphCli(args, { rootDir, projectDir }) {
  const sub = args[0] || 'stat';
  const json = args.includes('--json');
  if (sub === 'build') return runBuild({ rootDir, projectDir, json, coChange: !args.includes('--no-co-change') });
  if (sub === 'stat') return runStat({ projectDir, json });
  if (sub === 'query') {
    const id = args.slice(1).find((a) => !a.startsWith('--'));
    if (!id) {
      process.stderr.write('Usage: construct matrix query <node-id> [--json]\n');
      return 1;
    }
    return runQuery({ projectDir, id, json });
  }
  process.stderr.write(`Unknown graph subcommand: ${sub}. Available: build, stat, query\n`);
  return 1;
}
