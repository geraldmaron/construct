/**
 * lib/graph/validate.mjs — living-graph structural validation.
 *
 * validateGraph() checks workflow→provider→tool requires-edges, provider-manifest
 * disk presence, doc-file existence, capability test coverage (LMCP-C5,
 * sourced from lib/graph/gaps.mjs so `graph validate` and
 * `graph missing-tests` never disagree), workflow-manifest liveness
 * (roleChain resolution, skill existence, acyclic handoffs, surface/mode
 * reachability — LMCP-C11, lib/workflows/liveness.mjs), and workflow
 * surface parity (declared `surfaces` vs actual CLI/MCP/SDK registration —
 * LMCP-D4, lib/workflows/surface-parity.mjs), classifying each gap
 * as error vs warning per deployment mode (solo lenient, team/enterprise
 * strict). Backs `construct graph validate`.
 */

import { loadGraph, nodesByType, dependenciesOf, dependentsOf } from './store.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { loadAllWorkflows } from '../workflows/loader.mjs';
import { checkWorkflowLiveness } from '../workflows/liveness.mjs';
import { checkSurfaceParity } from '../workflows/surface-parity.mjs';
import { findMissingTestCapabilities } from './gaps.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MANIFESTS_REL_DIR = path.join('lib', 'extensions', 'manifests');

export function nodeParts(id) {
  const colon = id.indexOf(':');
  return colon === -1 ? { type: null, key: id } : { type: id.slice(0, colon), key: id.slice(colon + 1) };
}

export function validateGraph(rootDir, { strict = false, deploymentMode } = {}) {
  const graph = loadGraph(rootDir);
  if (!graph.exists) {
    return { valid: false, errors: ['no graph found — run construct graph build first'], warnings: [], infos: [] };
  }

  const mode = deploymentMode || getDeploymentMode(process.env, { cwd: rootDir });
  const isStrict = mode === 'team' || mode === 'enterprise' || strict;

  const errors = [];
  const warnings = [];
  const infos = [];

  const workflowNodes = nodesByType(graph, 'workflow');
  for (const wf of workflowNodes) {
    const embeddingCaps = dependentsOf(graph, wf.id, 'embeds');
    for (const capId of embeddingCaps) {
      const usedToolIds = dependenciesOf(graph, capId, 'uses')
        .filter(id => id.startsWith('provider:'));
      for (const providerId of usedToolIds) {
        const providerToolIds = dependenciesOf(graph, providerId, 'requires');
        const hasRequiredTools = providerToolIds.some(toolId =>
          dependenciesOf(graph, capId, 'requires').includes(toolId)
        );
        if (!hasRequiredTools) {
          const providerName = nodeParts(providerId).key;
          const msg = `workflow '${wf.name || wf.id}' embeds capability '${capId}' missing 'requires' edge to provider tools for '${providerName}'`;
          if (isStrict) errors.push(msg); else warnings.push(msg);
        }
      }
    }
  }

  const providerNodes = nodesByType(graph, 'provider');
  for (const provider of providerNodes) {
    const providerName = provider.attrs?.id || nodeParts(provider.id).key;
    const manifestPath = path.join(rootDir, MANIFESTS_REL_DIR, `${providerName}.manifest.json`);
    if (!existsSync(manifestPath)) {
      const msg = `provider '${provider.id}' has no manifest on disk at ${path.relative(rootDir, manifestPath)}`;
      if (isStrict) errors.push(msg); else warnings.push(msg);
    }
  }

  const docNodes = nodesByType(graph, 'doc');
  for (const doc of docNodes) {
    const docRel = doc.attrs?.path || nodeParts(doc.id).key;
    if (docRel) {
      const resolved = path.isAbsolute(docRel) ? docRel : path.join(rootDir, docRel);
      if (!existsSync(resolved)) {
        const msg = `doc '${doc.id}' references file '${resolved}' that does not exist`;
        if (isStrict) errors.push(msg); else warnings.push(msg);
      }
    }
  }

  // Capability test coverage (LMCP-C5): sourced from the same
  // findMissingTestCapabilities the `missing-tests` gap query uses, so the
  // two never drift out of consistency with each other.
  const gaps = findMissingTestCapabilities(rootDir);
  for (const capId of gaps.capabilities) {
    const msg = `capability '${capId}' has zero validating tests`;
    if (isStrict) errors.push(msg); else warnings.push(msg);
  }
  for (const wfId of gaps.workflows) {
    const msg = `workflow '${wfId}' has zero validated embedding capability`;
    if (isStrict) errors.push(msg); else warnings.push(msg);
  }

  // Workflow liveness (LMCP-C11): schema validation only checks shape; these
  // checks catch a roleChain naming a nonexistent specialist, a circular
  // handoff, or a workflow no surface/mode can reach — failures that
  // otherwise surface only at workflow-run time.
  const { workflows } = loadAllWorkflows({ rootDir });
  const { violations } = checkWorkflowLiveness(workflows, { rootDir });
  for (const msg of violations) {
    if (isStrict) errors.push(msg); else warnings.push(msg);
  }

  // Workflow surface parity (LMCP-D4): a manifest's declared `surfaces` must
  // match its actual CLI/MCP registration (both wrap the same invokeWorkflow
  // core, so any undeclared divergence is a real authoring drift, not a
  // runtime possibility) — an undeclared mismatch is always an error,
  // regardless of deployment mode, since it is never a matter of team policy.
  const { errors: surfaceErrors, infos: surfaceInfos } = checkSurfaceParity(workflows);
  errors.push(...surfaceErrors);
  infos.push(...surfaceInfos);

  infos.push('degraded_by check: not yet implemented (no degraded_by edges in C1 scope)');
  infos.push('evidenced_by edges: sourced from persisted orchestration runs (LMCP-C9, see lib/graph/runtime-evidence.mjs and `graph explain`)');

  const valid = errors.length === 0;
  return { valid, errors, warnings, infos };
}
