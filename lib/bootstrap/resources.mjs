/**
 * lib/bootstrap/resources.mjs — registry of optional resources Construct can spin up.
 *
 * A resource is something Construct can use but does not require: Postgres
 * with pgvector, the local ONNX embedding model, Docker, git, etc. Each
 * resource declares:
 *
 *   id            stable identifier
 *   displayName   human-readable label
 *   required      true → missing means CLI commands fail; false → fall back
 *   detect()      async probe → { present, version?, location?, healthy?, detail? }
 *   install()     async installer → { method, success, log }   (optional)
 *   fallback()    string explaining what runs in degraded mode
 *   consentKey    env var name in config.env for cached operator consent
 *   downloadSize  approximate install size in bytes (informational)
 *
 * The registry is consulted by:
 *   - `construct init`         walks every resource, asks consent, installs
 *   - `construct doctor --bootstrap`  re-probes every resource verbosely
 *   - lazy-install paths in hooks (consult the cached consent silently)
 *
 * Resources are "additive" — anyone can register a new resource via
 * `registerResource()` so plugins (or future built-ins) can extend the set
 * without forking this file.
 */

const REGISTRY = new Map();

/**
 * Register a resource. Throws if the id is already registered.
 */
export function registerResource(resource) {
  if (!resource || typeof resource !== 'object') {
    throw new Error('registerResource: resource must be an object');
  }
  for (const field of ['id', 'displayName', 'detect', 'consentKey']) {
    if (!resource[field]) throw new Error(`registerResource: ${field} is required`);
  }
  if (REGISTRY.has(resource.id)) {
    throw new Error(`registerResource: ${resource.id} already registered`);
  }
  REGISTRY.set(resource.id, resource);
}

export function listResources() {
  return [...REGISTRY.values()];
}

export function getResource(id) {
  return REGISTRY.get(id);
}

export function clearResourceRegistry() {
  REGISTRY.clear();
}

/**
 * Probe one resource. Catches errors so a broken probe never cascades.
 */
export async function probeResource(resource) {
  if (!resource || typeof resource.detect !== 'function') {
    return { id: resource?.id, present: false, error: 'resource has no detect()' };
  }
  try {
    const result = await resource.detect();
    return {
      id: resource.id,
      displayName: resource.displayName,
      required: resource.required ?? false,
      present: !!result?.present,
      version: result?.version || null,
      location: result?.location || null,
      healthy: result?.healthy ?? !!result?.present,
      detail: result?.detail || null,
      consentKey: resource.consentKey,
      fallback: resource.fallback?.() || null,
      downloadSize: resource.downloadSize || null,
      installable: typeof resource.install === 'function',
    };
  } catch (err) {
    return {
      id: resource.id,
      displayName: resource.displayName,
      required: resource.required ?? false,
      present: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Probe every registered resource. Returns a sorted array (required first,
 * then by id) so callers can render a deterministic report.
 */
export async function probeAll() {
  const probes = await Promise.all([...REGISTRY.values()].map(probeResource));
  return probes.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Format a probe result line for human display.
 */
export function formatProbe(probe) {
  const status = probe.present
    ? (probe.healthy ? '✓' : '⚠')
    : (probe.required ? '✗' : '○');
  const v = probe.version ? ` (${probe.version})` : '';
  const loc = probe.location ? ` ${probe.location}` : '';
  const detail = probe.detail ? ` — ${probe.detail}` : '';
  const fallback = !probe.present && !probe.required && probe.fallback
    ? `\n     fallback: ${probe.fallback}`
    : '';
  const install = !probe.present && probe.installable
    ? `\n     installable via construct init`
    : '';
  return `  ${status}  ${probe.displayName}${v}${loc}${detail}${fallback}${install}`;
}
