/**
 * lib/graph/validate.mjs — living-graph structural validation.
 *
 * validateGraph() checks workflow→provider→tool requires-edges, provider-manifest
 * disk presence, doc-file existence, capability test coverage (LMCP-C5,
 * sourced from lib/graph/gaps.mjs so `graph validate` and
 * `graph missing-tests` never disagree), workflow-manifest liveness
 * (roleChain resolution, skill existence, acyclic handoffs, surface/mode
 * reachability — LMCP-C11, lib/procedures/liveness.mjs), and workflow
 * surface parity (declared `surfaces` vs actual CLI/MCP/SDK registration —
 * LMCP-D4, lib/procedures/surface-parity.mjs), classifying each gap
 * as error vs warning per deployment mode (solo lenient, team/enterprise
 * strict). Backs `construct graph validate`.
 */

import { loadGraph, nodesByType, dependenciesOf, dependentsOf } from './store.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { loadAllProcedures } from '../procedures/loader.mjs';
import { checkProcedureLiveness } from '../procedures/liveness.mjs';
import { checkSurfaceParity } from '../procedures/surface-parity.mjs';
import { findMissingTestCapabilities } from './gaps.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MANIFESTS_REL_DIR = path.join('lib', 'extensions', 'manifests');

function resolveExistingPath(rootDir, packageRoot, relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return existsSync(relOrAbs) ? relOrAbs : null;
  const rel = String(relOrAbs).replace(/^\/+/, '');
  const roots = [rootDir];
  if (packageRoot && path.resolve(packageRoot) !== path.resolve(rootDir)) {
    roots.unshift(packageRoot);
  }
  for (const root of roots) {
    const candidate = path.join(root, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function nodeParts(id) {
  const colon = id.indexOf(':');
  return colon === -1 ? { type: null, key: id } : { type: id.slice(0, colon), key: id.slice(colon + 1) };
}

export function validateGraph(rootDir, { strict = false, deploymentMode, packageRoot = null } = {}) {
  const pkgRoot = packageRoot || rootDir;
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
    const manifestRel = path.join(MANIFESTS_REL_DIR, `${providerName}.manifest.json`);
    const manifestPath = resolveExistingPath(rootDir, pkgRoot, manifestRel);
    if (!manifestPath) {
      const msg = `provider '${provider.id}' has no manifest on disk at ${manifestRel}`;
      if (isStrict) errors.push(msg); else warnings.push(msg);
    }
  }

  const docNodes = nodesByType(graph, 'doc');
  for (const doc of docNodes) {
    const docRel = doc.attrs?.path || nodeParts(doc.id).key;
    if (docRel) {
      const resolved = resolveExistingPath(rootDir, pkgRoot, docRel);
      if (!resolved) {
        const msg = `doc '${doc.id}' references file '${docRel}' that does not exist`;
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

  // Embed-node integrity (LMCP-P6): every binding an embed manifest declares
  // must resolve to a real node. A `uses`/`owned_by`/`governed_by` edge whose
  // target node is absent is a broken binding — the manifest names a provider,
  // worker-profile, or contract that does not exist in the graph — and is drift the
  // C8 gate must catch. An embed with zero validating tests is treated like an
  // untested capability so presets cannot silently lose coverage.
  const embedTargetRels = [
    ['uses', 'provider'],
    ['owned_by', 'worker-profile'],
    ['governed_by', 'contract'],
  ];
  for (const embed of nodesByType(graph, 'embed')) {
    for (const [rel, kind] of embedTargetRels) {
      for (const targetId of dependenciesOf(graph, embed.id, rel)) {
        if (!graph.nodes.has(targetId)) {
          const msg = `embed '${embed.name || embed.id}' binds ${kind} '${targetId}' which has no node in the graph`;
          if (isStrict) errors.push(msg); else warnings.push(msg);
        }
      }
    }
    if (dependentsOf(graph, embed.id, 'validates').length === 0) {
      const msg = `embed '${embed.name || embed.id}' has zero validating tests`;
      if (isStrict) errors.push(msg); else warnings.push(msg);
    }
  }

  // Security-coverage edge integrity (LMCP-N8): a `@secures <id>` tag that
  // names a workflow/embed with no node is a typo'd or stale link that would
  // silently contribute zero coverage — flag the dangling target.
  for (const edge of graph.edges) {
    if (edge.rel !== 'secures') continue;
    if (!graph.nodes.has(edge.to)) {
      const msg = `security test '${edge.from}' @secures '${edge.to}' which has no node in the graph`;
      if (isStrict) errors.push(msg); else warnings.push(msg);
    }
  }

  // Workflow liveness (LMCP-C11): schema validation only checks shape; these
  // checks catch a roleChain naming a nonexistent worker-profile, a circular
  // handoff, or a workflow no surface/mode can reach — failures that
  // otherwise surface only at workflow-run time.
  const { procedures } = loadAllProcedures({ rootDir });
  const { violations } = checkProcedureLiveness(procedures, { rootDir: pkgRoot });
  for (const msg of violations) {
    if (isStrict) errors.push(msg); else warnings.push(msg);
  }

  // Workflow surface parity (LMCP-D4): a manifest's declared `surfaces` must
  // match its actual CLI/MCP registration (both wrap the same invokeWorkflow
  // core, so any undeclared divergence is a real authoring drift, not a
  // runtime possibility) — an undeclared mismatch is always an error,
  // regardless of deployment mode, since it is never a matter of team policy.
  const { errors: surfaceErrors, infos: surfaceInfos } = checkSurfaceParity(procedures);
  errors.push(...surfaceErrors);
  infos.push(...surfaceInfos);

  infos.push('degraded_by check: not yet implemented (no degraded_by edges in C1 scope)');
  infos.push('evidenced_by edges: sourced from persisted orchestration runs (LMCP-C9, see lib/graph/runtime-evidence.mjs and `graph explain`)');

  const valid = errors.length === 0;
  return { valid, errors, warnings, infos };
}
