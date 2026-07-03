/**
 * Deployment-mode capability registry.
 *
 * Maps each deployment mode (solo / team / enterprise) to its declared capabilities
 * and their current implementation status. This is the single authoritative source
 * for what a mode promises versus what is actually wired up at runtime.
 *
 * Status values:
 *   'implemented'     — fully wired; production-safe.
 *   'stub'            — code path exists but returns null / falls back silently.
 *   'not-implemented' — no code path exists yet; will throw or degrade if invoked.
 *
 * How to add a new capability:
 *   1. Add an entry to the relevant mode array in CAPABILITY_REGISTRY below.
 *   2. Set status to 'not-implemented' or 'stub' until the implementation lands.
 *   3. Flip to 'implemented' in the same PR that wires the real code.
 *   4. Add a CHANGELOG entry referencing this file and the wiring commit.
 */

export const CAPABILITY_REGISTRY = {
  solo: [
    { id: 'filesystem-queue', label: 'Filesystem task queue', status: 'implemented' },
    { id: 'local-memory', label: 'Local memory', status: 'implemented' },
    { id: 'embedded-lancedb', label: 'Embedded LanceDB vector store', status: 'implemented' },
    { id: 'direct-mcp', label: 'Direct MCP dispatch', status: 'implemented' },
  ],
  team: [
    { id: 'postgres-queue', label: 'Postgres task queue', status: 'stub' },
    { id: 'shared-memory', label: 'Shared memory store', status: 'stub' },
    { id: 'docker-workers', label: 'Docker worker pool', status: 'not-implemented' },
    { id: 'central-telemetry', label: 'Central telemetry', status: 'stub' },
    { id: 'brokered-mcp', label: 'Brokered MCP dispatch', status: 'stub' },
  ],
  enterprise: [
    { id: 'tenant-isolation', label: 'Tenant isolation', status: 'not-implemented' },
    { id: 'rbac', label: 'RBAC/ABAC', status: 'not-implemented' },
    { id: 'isolated-workers', label: 'Isolated worker containers', status: 'not-implemented' },
    { id: 'signed-mcp-allowlists', label: 'Signed MCP allowlists', status: 'not-implemented' },
    { id: 'mandatory-audit', label: 'Mandatory audit log', status: 'not-implemented' },
  ],
};

// Returns the capability list for the given mode, or an empty array for unknown modes.

export function getCapabilities(mode) {
  return CAPABILITY_REGISTRY[mode] ?? [];
}

// Aggregates the capability list into a single readiness label.
// 'fully-implemented' — every capability is 'implemented'.
// 'degraded'          — at least one is 'stub' (and none are 'not-implemented').
// 'unsupported'       — at least one is 'not-implemented'.

export function getModeCapabilityStatus(mode) {
  const caps = getCapabilities(mode);
  if (caps.length === 0) return 'unsupported';
  if (caps.some(c => c.status === 'not-implemented')) return 'unsupported';
  if (caps.some(c => c.status === 'stub')) return 'degraded';
  return 'fully-implemented';
}

// Returns capabilities whose status is not 'implemented'.

export function getUnsupportedCapabilities(mode) {
  return getCapabilities(mode).filter(c => c.status !== 'implemented');
}

// The three valid status values, as a constant so callers don't string-compare.

export const CAPABILITY_STATUSES = ['implemented', 'stub', 'not-implemented'];

// Test-only injection: temporarily append a capability to the given mode(s) and return a cleanup fn.

export function _injectCapabilityForTesting({ id, label = id, modes = {} }) {
  const injected = [];
  for (const [mode, status] of Object.entries(modes)) {
    if (!CAPABILITY_REGISTRY[mode]) CAPABILITY_REGISTRY[mode] = [];
    const entry = { id, label, status };
    CAPABILITY_REGISTRY[mode].push(entry);
    injected.push({ mode, entry });
  }
  return function cleanup() {
    for (const { mode, entry } of injected) {
      const arr = CAPABILITY_REGISTRY[mode];
      const idx = arr.indexOf(entry);
      if (idx !== -1) arr.splice(idx, 1);
    }
  };
}
