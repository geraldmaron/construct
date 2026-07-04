/**
 * lib/workflows/surface-parity.mjs — workflow manifest surface-parity check (LMCP-D4).
 *
 * Compares each workflow manifest's declared `surfaces` field against its
 * ACTUAL registration, derived from the real dispatch code rather than
 * inferred:
 *
 *   - lib/embedded-contract/workflow-invoke.mjs exports one `invokeWorkflow`
 *     core that CLI (`construct workflow invoke --workflow-type`, bin/construct
 *     cmdWorkflow), MCP (`workflow_invoke`, lib/mcp/tools/embedded-contract.mjs),
 *     and SDK (`invokeWorkflow`, lib/embedded-contract/index.mjs) all wrap
 *     unchanged (lib/embedded-contract/envelope.mjs even documents the three
 *     surfaces as "structurally identical"). That core resolves a workflow id
 *     through `getWorkflowDef` (lib/embedded-contract/workflow-defs.mjs),
 *     whose DEFS table is generated from every loaded manifest with
 *     `type !== 'embed'`.
 *   - A manifest with `type !== 'embed'` is therefore registered on cli, mcp,
 *     AND sdk simultaneously — there is no dispatch path that can register a
 *     workflow id on one of the three without the other two, so per-manifest
 *     divergence between them is structurally impossible today. sdk carries
 *     no separate opt-in and is reported as an info line, never a checkable
 *     declared/actual pair — flagging it as a per-manifest mismatch would
 *     fail every manifest for a fact no author can change.
 *   - A manifest with `type === 'embed'` (ADR-0061) is scheduled by the embed
 *     daemon on a cadence; it is never reached through workflow_invoke /
 *     `construct workflow invoke` / SDK invokeWorkflow at all, so its actual
 *     registration is the empty set on cli and mcp.
 *
 * checkSurfaceParity() flags two failure shapes as errors:
 *   1. A manifest declares a surface ('cli' or 'mcp') it is not actually
 *      registered on (an embed manifest declaring 'cli'/'mcp', or a non-embed
 *      manifest whose id is absent from WORKFLOW_TYPES because it failed to
 *      load into workflow-defs.mjs).
 *   2. A non-embed manifest omits a surface ('cli' or 'mcp') it IS actually
 *      registered on.
 * Both shapes are suppressed, with a passing info line instead, when the
 * manifest carries a `surfaceExceptions` map with a non-empty `reason` string
 * for that surface — `surfaceExceptions` is an optional, unvalidated field
 * (manifests load with strict:false in this caller, so unknown fields pass
 * through) rather than a schema addition, keeping this rule additive.
 */

import { WORKFLOW_TYPES } from '../embedded-contract/workflow-defs.mjs';

/** The two surfaces a manifest can meaningfully declare/omit per-workflow. */
export const DECLARABLE_SURFACES = ['cli', 'mcp'];

/**
 * Actual registration for a manifest, derived from workflow-defs.mjs's DEFS
 * table (built from loadAllWorkflows() — the same loader this check itself
 * consumes elsewhere) rather than re-implemented here.
 *
 * @param {object} manifest
 * @returns {string[]} subset of DECLARABLE_SURFACES the manifest is actually
 *   dispatchable on; sdk is always additionally true for non-embed manifests
 *   but is not part of this declarable set (see module header).
 */
export function actualSurfaces(manifest) {
  if (!manifest || manifest.type === 'embed') return [];
  return WORKFLOW_TYPES.includes(manifest.id) ? [...DECLARABLE_SURFACES] : [];
}

/**
 * Look up a manifest's declared exception reason for a surface, if any.
 *
 * @param {object} manifest
 * @param {string} surface
 * @returns {string|null} the reason string, or null when no valid exception is declared
 */
function exceptionReason(manifest, surface) {
  const exceptions = manifest?.surfaceExceptions;
  if (!exceptions || typeof exceptions !== 'object') return null;
  const entry = exceptions[surface];
  if (typeof entry === 'string' && entry.trim()) return entry;
  if (entry && typeof entry === 'object' && typeof entry.reason === 'string' && entry.reason.trim()) return entry.reason;
  return null;
}

/**
 * checkSurfaceParity(manifests)
 *
 * Runs the surface-parity check over an already-loaded manifest list (each
 * carrying `_filePath` and `id`, per lib/workflows/loader.mjs). Never throws.
 *
 * @param {object[]} manifests
 * @returns {{ errors: string[], infos: string[] }}
 */
export function checkSurfaceParity(manifests = []) {
  const errors = [];
  const infos = [];

  for (const manifest of manifests) {
    const label = manifest._filePath || manifest.id || '(unknown manifest)';
    const declared = new Set(Array.isArray(manifest.surfaces) ? manifest.surfaces : []);
    const actual = new Set(actualSurfaces(manifest));

    for (const surface of DECLARABLE_SURFACES) {
      const isDeclared = declared.has(surface);
      const isActual = actual.has(surface);
      if (isDeclared === isActual) continue;

      const reason = exceptionReason(manifest, surface);
      if (reason) {
        const shape = isDeclared ? 'declared but not registered' : 'registered but not declared';
        infos.push(`${label}: workflow '${manifest.id}' surface '${surface}' is ${shape} — declared exception: ${reason}`);
        continue;
      }

      if (isDeclared && !isActual) {
        errors.push(`${label}: workflow '${manifest.id}' declares surface '${surface}' but is not actually registered there (no reason given — add a 'surfaceExceptions.${surface}' reason or remove the declaration)`);
      } else {
        errors.push(`${label}: workflow '${manifest.id}' is registered on surface '${surface}' but does not declare it in 'surfaces' (no reason given — add '${surface}' to 'surfaces' or a 'surfaceExceptions.${surface}' reason)`);
      }
    }
  }

  return { errors, infos };
}
