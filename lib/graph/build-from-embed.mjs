/**
 * lib/graph/build-from-embed.mjs — seed the living graph with embed-capability
 * nodes and edges from loaded embed manifests.
 *
 * Embedded Worker Profiles were invisible to the graph: build-from-
 * registry seeds provider/worker-profile/contract nodes but knows nothing of the
 * `type:"embed"` manifests, so C8's drift gate could not protect a preset whose
 * test was deleted or whose binding target broke. This seeder closes that gap.
 *
 * Per embed manifest it emits one `embed:<id>` node plus edges into nodes the
 * registry seeder already produces, reusing the existing relation vocabulary
 * rather than inventing one:
 *   embed --uses-->        provider     (each embed.providerBindings entry)
 *   embed --owned_by-->    worker-profile (embed.workerProfileId — who runs it)
 *   embed --governed_by--> contract     (embed.outputContract)
 *   test  --validates-->   embed        (`@embed <id>` acceptance-test tag, C10 format)
 *
 * Provider and Worker Profile targets must already exist. Output contracts are
 * declared by their canonical embed Procedure, so this seeder creates those
 * contract nodes from the same record. A missing provider or Worker Profile is
 * drift, and
 * lib/graph/validate.mjs reports the dangling target as an error (strict) so
 * the C8 gate fails instead of the graph quietly gaining an orphan endpoint.
 */

import { nodeId } from './store.mjs';
import { loadEmbedCapabilities } from '../embed/capability-loader.mjs';
import { extractEmbedTestEdges } from '../test-corpus-inventory.mjs';

/**
 * @param {{ rootDir: string }} opts
 * @returns {{ nodes: object[], edges: object[], errors: string[] }}
 */
export function buildFromEmbed({ rootDir }) {
  const { capabilities, errors } = loadEmbedCapabilities({ rootDir });

  const nodes = [];
  const edges = [];
  const embedIds = new Set();

  for (const manifest of capabilities) {
    const embed = manifest.embed ?? {};
    const id = manifest.id;
    if (!id) continue;
    embedIds.add(id);

    const from = nodeId('embed', id);
    nodes.push({
      id: from,
      type: 'embed',
      name: id,
      attrs: {
        workerProfileId: embed.workerProfileId ?? null,
        outputContract: embed.outputContract ?? null,
        providerBindings: embed.providerBindings ?? [],
        runtime: embed.runtime ?? null,
        proposalAuthority: embed.proposalAuthority ?? null,
      },
    });

    for (const providerId of embed.providerBindings ?? []) {
      edges.push({ from, to: nodeId('provider', providerId), rel: 'uses', source: 'embed-manifest' });
    }
    if (embed.workerProfileId) {
      edges.push({ from, to: nodeId('worker-profile', embed.workerProfileId), rel: 'owned_by', source: 'embed-manifest' });
    }
    if (embed.outputContract) {
      nodes.push({
        id: nodeId('contract', embed.outputContract),
        type: 'contract',
        name: embed.outputContract,
        attrs: { source: 'embed-procedure', procedureId: id },
      });
      edges.push({ from, to: nodeId('contract', embed.outputContract), rel: 'governed_by', source: 'embed-manifest' });
    }
  }

  // A `@embed <id>` tag on an id with no loaded manifest is a stale annotation,
  // not a fabricated node — skip it rather than mint a phantom embed node. The
  // tagging test may carry no `@capability`, so its node is minted here (the
  // store dedups by id if build-from-corpus also emitted it).
  for (const { testPath, embedId } of extractEmbedTestEdges({ rootDir })) {
    if (!embedIds.has(embedId)) continue;
    const testId = nodeId('test', testPath);
    nodes.push({ id: testId, type: 'test', name: testPath, attrs: { path: testPath, exists: true } });
    edges.push({ from: testId, to: nodeId('embed', embedId), rel: 'validates', source: 'embed-manifest' });
  }

  return { nodes, edges, errors };
}
