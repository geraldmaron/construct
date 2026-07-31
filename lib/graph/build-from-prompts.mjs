/**
 * lib/graph/build-from-prompts.mjs — prompt-fragment and composed-prompt graph nodes.
 *
 * Composes registry Worker Profiles with provenance enabled and emits
 * prompt-fragment nodes plus composes_into edges to a composed-prompt-instance
 * node per profile. Consumed by construct graph build.
 */

import crypto from 'node:crypto';

import { loadRegistry } from '../registry/loader.mjs';
import { composePromptWithProvenance } from '../prompt-composer.mjs';
import { executionContractModelForOperatingProfile, canonicalRoleFlavorsForWorkerProfile } from '../certification/prompt-versions.mjs';
import { nodeId } from './store.mjs';

const DEFAULT_OPERATING_PROFILE = 'balanced';

function fragmentNodeId(workerProfileId, layer, label) {
  const key = `${workerProfileId}:${layer}:${label}`;
  return nodeId('prompt-fragment', key);
}

function composedPromptNodeId(workerProfileId, operatingProfileId, promptHash) {
  return nodeId('composed-prompt', `${workerProfileId}:${operatingProfileId}:${promptHash.slice(0, 16)}`);
}

/**
 * @param {{ rootDir: string, workerProfileIds?: string[] }} opts
 * @returns {{ nodes: object[], edges: object[], errors: string[] }}
 */
export function buildFromPrompts({ rootDir, workerProfileIds = null } = {}) {
  const registry = loadRegistry({ rootDir });
  const ids = workerProfileIds
    ?? Object.keys(registry.workerProfiles ?? {}).sort();
  const nodes = [];
  const edges = [];
  const errors = [];

  for (const workerProfileId of ids) {
    try {
      const { composed, provenance } = composePromptWithProvenance(workerProfileId, {
        rootDir,
        registry,
        injectLearnedPatterns: false,
        roleFlavors: canonicalRoleFlavorsForWorkerProfile(workerProfileId),
        executionContractModel: executionContractModelForOperatingProfile(DEFAULT_OPERATING_PROFILE),
      });

      if (provenance?.degraded) {
        errors.push(`${workerProfileId}: provenance degraded (${provenance.error ?? 'unknown'})`);
        continue;
      }
      if (!provenance?.layers?.length) continue;

      const promptHash = crypto.createHash('sha256').update(composed.system || '').digest('hex');
      const composedId = composedPromptNodeId(workerProfileId, DEFAULT_OPERATING_PROFILE, promptHash);
      nodes.push({
        id: composedId,
        type: 'composed-prompt',
        name: `${workerProfileId}:${DEFAULT_OPERATING_PROFILE}`,
        attrs: {
          workerProfileId,
          operatingProfileId: DEFAULT_OPERATING_PROFILE,
          promptHash,
          totalTokens: composed.totalTokens ?? 0,
        },
      });

      for (const layer of provenance.layers) {
        if (!layer.included || !layer.contentLength) continue;
        const fragId = fragmentNodeId(workerProfileId, layer.layer, layer.label);
        nodes.push({
          id: fragId,
          type: 'prompt-fragment',
          name: layer.label,
          attrs: {
            workerProfileId,
            layer: layer.layer,
            label: layer.label,
            contentLength: layer.contentLength,
            tokenEstimate: layer.tokenEstimate,
            pruned: layer.pruned === true,
            sourcePath: layer.sourcePath ?? null,
          },
        });
        edges.push({
          from: fragId,
          to: composedId,
          rel: 'composes_into',
          source: 'registry',
        });
      }
    } catch (err) {
      errors.push(`${workerProfileId}: ${err?.message ?? String(err)}`);
    }
  }

  return { nodes, edges, errors };
}
