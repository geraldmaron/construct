/**
 * lib/runtime/contract/interface.mjs — abstract runtime-adapter interface and validation.
 *
 * A "runtime" is anything Construct hands work to and reads a result back
 * from: an in-process handler, a coding-agent CLI (Claude Code, an
 * ACP-speaking agent), or any future replacement. Every runtime adapter must
 * export an object matching this shape so the conformance suite
 * (./conformance.mjs) and the registry (./registry.mjs) can treat any
 * conforming adapter interchangeably — the seam M5a (model-loop migration)
 * and M4 (Worker Profile runtime selection) depend on to swap runtimes
 * without touching their callers. Mirrors the shape of the existing provider
 * contract (lib/providers/contract/interface.mjs) per this bead's
 * implementation guidance to generalize that precedent, not invent a new one.
 *
 * Required surface (every adapter, regardless of declared capabilities):
 *   name          - non-empty string, unique per adapter instance
 *   kind          - non-empty string; recommended values: 'general', 'coding'
 *   capabilities  - string[] drawn from CAPABILITIES, declares OPTIONAL
 *                   behavior beyond the mandatory base. 'interrupt' means
 *                   cancel() can actually stop in-flight work; its absence
 *                   means cancel() is a safe no-op, not a missing method —
 *                   some real transports (e.g. a blocking spawnSync call)
 *                   genuinely cannot be interrupted once started, and the
 *                   contract requires that limitation be declared, not hidden.
 *   init(config)  - async setup; must run before invoke()/health() are valid
 *   invoke(request, context) - async; runs one unit of work and resolves a
 *                   RuntimeResult { id, status, output, error } (see
 *                   conformance.mjs for the full shape contract). context
 *                   may carry an invocationId chosen by the caller — an
 *                   adapter must honor a supplied id so cancel(invocationId)
 *                   can target a call before it settles.
 *   health()      - async liveness probe, returns { live, detail? }
 *   cancel(invocationId) - async; always present, always resolves (never
 *                   throws), returns { cancelled, reason? }. This is the
 *                   explicit capability/permission surface the bead's
 *                   Security note requires: an adapter's authority to stop
 *                   in-flight work is declared via 'interrupt', not implicit.
 */

const CAPABILITIES = ['interrupt', 'stream', 'sandbox', 'concurrent'];

/**
 * Validate a runtime object against the interface contract.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validate(runtime) {
  const errors = [];

  if (!runtime || typeof runtime !== 'object') {
    return { valid: false, errors: ['Runtime must be a non-null object'] };
  }
  if (typeof runtime.name !== 'string' || !runtime.name) {
    errors.push('Runtime must have a non-empty string "name"');
  }
  if (typeof runtime.kind !== 'string' || !runtime.kind) {
    errors.push('Runtime must have a non-empty string "kind"');
  }
  if (!Array.isArray(runtime.capabilities)) {
    errors.push('Runtime must declare "capabilities" as an array');
  } else {
    for (const cap of runtime.capabilities) {
      if (!CAPABILITIES.includes(cap)) {
        errors.push(`Unknown capability "${cap}". Valid: ${CAPABILITIES.join(', ')}`);
      }
    }
  }
  for (const method of ['init', 'invoke', 'health', 'cancel']) {
    if (typeof runtime[method] !== 'function') {
      errors.push(`Runtime must implement ${method}()`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a runtime declares a given capability.
 */
export function hasCapability(runtime, capability) {
  return Array.isArray(runtime.capabilities) && runtime.capabilities.includes(capability);
}

export { CAPABILITIES };
