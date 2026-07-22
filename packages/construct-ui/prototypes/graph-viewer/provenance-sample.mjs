/**
 * packages/construct-ui/prototypes/graph-viewer/provenance-sample.mjs —
 * Diagram-Card-shaped provenance for a rendered view (construct-tsyfe.4.5).
 *
 * PROTOTYPE ONLY. Uses lib/diagram-card.mjs's buildDiagramCard rather than
 * inventing a parallel provenance shape, per construct-tsyfe.4.1. Finding:
 * lib/diagram-card.mjs's ENGINES enum (`d2`, `dot`, `mermaid-source-only`,
 * `unknown`) has no `cytoscape` member yet, so a genuinely engine-accurate
 * card cannot be produced today — this call intentionally resolves to
 * `engine: 'unknown'`, `degraded: true`, and a `reason` naming the gap. If
 * Cytoscape is adopted for production, a follow-up bead must add `'cytoscape'`
 * to ENGINES (lib/diagram-card.mjs:38) before this stops being degraded.
 */

import { buildDiagramCard } from '../../../../lib/diagram-card.mjs';

export function sampleProvenanceCard({ view, nodeCount, edgeCount }) {
  return buildDiagramCard({
    id: `graph-viewer-prototype:${view}`,
    source: `.construct/graph/{nodes,edges}.jsonl (${view} view)`,
    engine: 'cytoscape', // not in ENGINES -> buildDiagramCard degrades this honestly
    securityProfile: 'browser-headless-no-eval-no-remote-fetch',
    accessibilityDescription: `${view} view of the Construct dependency graph: ${nodeCount} nodes, ${edgeCount} edges, rendered client-side by Cytoscape.js from local .construct/graph/ data.`,
    provenance: {
      module: 'packages/construct-ui/prototypes/graph-viewer/transform.mjs',
      command: 'construct-tsyfe.4.5 prototype bench.mjs',
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const card = sampleProvenanceCard({ view: 'application', nodeCount: 353, edgeCount: 524 });
  console.log(JSON.stringify(card, null, 2));
}
