/**
 * packages/construct-ui/prototypes/graph-viewer/entry.mjs — browser entry point for
 * the Cytoscape.js graph-viewer prototype (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY — served by dev-server.mjs for manual inspection, not built
 * into apps/docs or any production route. Mirrors packages/construct-ui/components/
 * mermaid.tsx's lazy `(await import('mermaid')).default` pattern: cytoscape
 * loads only when this module runs, never at page-shell load time, so a real
 * integration would keep the CLI/core bundle untouched (see the bundle-
 * isolation smoke test in tests/graph/).
 */

import { buildViewElements } from './transform.mjs';
import { VIEWS } from './view-vocab.mjs';

const STYLE = [
  { selector: 'node', style: { 'background-color': '#4f7cff', label: 'data(label)', 'font-size': 8, color: '#e8e8e8', 'text-outline-width': 1, 'text-outline-color': '#111' } },
  { selector: 'edge', style: { width: 1, 'line-color': '#666', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#666' } },
];

async function render(viewName) {
  const status = document.getElementById('status');
  status.textContent = `loading ${viewName} view…`;

  const [nodesRes, edgesRes] = await Promise.all([fetch('./fixtures/nodes.sample.json'), fetch('./fixtures/edges.sample.json')]);
  const nodes = await nodesRes.json();
  const edges = await edgesRes.json();

  const cytoscape = (await import('cytoscape')).default;
  const elements = buildViewElements(nodes, edges, VIEWS[viewName]);

  const t0 = performance.now();
  const container = document.getElementById('cy');
  container.innerHTML = '';
  const cy = cytoscape({ container, elements, style: STYLE, layout: { name: 'cose', animate: false } });
  // fit() called in the same tick as construction measured the container
  // before its first layout/paint pass and produced zoom:1/pan:(0,0) — i.e.
  // no fit at all — even though cy.width()/height() already reported the
  // correct size; one rAF tick resolves it. Real-integration follow-up:
  // confirm whether this is a Cytoscape.js quirk or specific to headless
  // preview rendering before shipping this as-is.
  cy.resize();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  cy.fit(cy.elements(), 20);
  const ms = Math.round((performance.now() - t0) * 100) / 100;

  status.textContent = `${viewName} view: ${elements.nodes.length} nodes, ${elements.edges.length} edges, rendered in ${ms}ms`;
  return cy;
}

let current = null;
async function switchView(viewName) {
  if (current) current.destroy();
  current = await render(viewName);
}

document.getElementById('view-application').addEventListener('click', () => switchView('application'));
document.getElementById('view-dependency').addEventListener('click', () => switchView('dependency'));
switchView('application');
