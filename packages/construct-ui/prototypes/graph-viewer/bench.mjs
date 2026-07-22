#!/usr/bin/env node
/**
 * packages/construct-ui/prototypes/graph-viewer/bench.mjs — headless perf bench at
 * real repo scale (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY, run manually (`node packages/construct-ui/prototypes/graph-viewer/bench.mjs`),
 * not part of `node --test`. Reads the live `.construct/graph/{nodes,edges}.jsonl`
 * produced by `node bin/construct graph build` (gitignored; regenerate if
 * missing) and measures, for both views: Cytoscape core construction time
 * (`headless: true`, no DOM/canvas — the same graph-model code path a browser
 * render would use) and a `cose` force-directed layout run, the realistic
 * worst case for an interactive viewer. Findings live in DECISION.md,
 * reproducible by re-running this script rather than taken on faith.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cytoscape from 'cytoscape';
import { parseJsonl, buildViewElements } from './transform.mjs';
import { VIEWS } from './view-vocab.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../..');
const nodesPath = path.join(rootDir, '.construct/graph/nodes.jsonl');
const edgesPath = path.join(rootDir, '.construct/graph/edges.jsonl');

if (!existsSync(nodesPath) || !existsSync(edgesPath)) {
  console.error(`missing ${nodesPath} / ${edgesPath} — run \`node bin/construct graph build\` first`);
  process.exit(1);
}

const nodes = parseJsonl(readFileSync(nodesPath, 'utf8'));
const edges = parseJsonl(readFileSync(edgesPath, 'utf8'));
console.log(`source graph: ${nodes.length} nodes, ${edges.length} edges (.construct/graph/meta.json)`);

for (const [viewName, view] of Object.entries(VIEWS)) {
  const elements = buildViewElements(nodes, edges, view);
  const elementCount = elements.nodes.length + elements.edges.length;

  const t0 = performance.now();
  const cy = cytoscape({ headless: true, styleEnabled: false, elements });
  const constructMs = performance.now() - t0;

  const t1 = performance.now();
  const layout = cy.layout({ name: 'cose', animate: false, numIter: 500 });
  layout.run();
  const layoutMs = performance.now() - t1;

  console.log(JSON.stringify({
    view: viewName,
    nodeCount: elements.nodes.length,
    edgeCount: elements.edges.length,
    elementCount,
    constructMs: Math.round(constructMs * 100) / 100,
    coseLayoutMs: Math.round(layoutMs * 100) / 100,
  }, null, 2));

  cy.destroy();
}
