/**
 * lib/doctor/diagnosis.mjs — typed failure-state taxonomy for the doctor command.
 *
 * Each constant names a distinct class of host / package / MCP / runtime / secrets
 * failure so doctor findings carry an actionable code rather than a bare boolean.
 * Consumers (bin/construct cmdDoctor, lib/host/readiness.mjs, tests) import these
 * keys to ensure the full taxonomy is covered and no failure collapses to a generic
 * "unhealthy" verdict.
 */

export const DOCTOR_STATES = {
  'missing-config': 'A required configuration file or directory is absent.',
  'stale-path': 'A registered path (toolkit, entrypoint, server) is outdated or points nowhere.',
  'disabled': 'A feature or gate is explicitly disabled in config.',
  'server-start-failure': 'The MCP or dashboard server failed to start or did not respond within the timeout.',
  'secret-leak': 'A credential or secret is exposed in a tracked file or insecure location.',
  'entrypoint-missing': 'A binary or script the runtime expects (construct-mcp, construct) is not found on PATH.',
  'healthy': 'The check passed with no issues detected.',
  'degraded': 'The check passed with warnings; functionality may be reduced.',
  'stub': 'The capability exists but is a no-op or partial implementation; not production-safe.',
};

/**
 * STUB_ICON — the distinct display character rendered next to stub-tier diagnoses.
 * Renderers that format doctor output should use this rather than hard-coding '~'.
 */
export const STUB_ICON = '~';

/**
 * classifyCapability(capabilityId, mode)
 *
 * Reads the capability registry for `mode` and maps the capability's status to one
 * of three classification strings:
 *   'implemented'     — fully wired; production-safe.
 *   'stub'            — code path exists but is a no-op / partial (status: 'stub').
 *   'not-implemented' — no code path exists yet (status: 'not-implemented').
 *
 * Returns 'not-implemented' when the capability is not found in the registry for
 * the given mode (unknown capability IDs are treated as absent).
 *
 * Dynamic import of mode-capabilities happens on first call — in hot paths,
 * prefer `classifyCapabilitySync` with a pre-fetched capabilities array.
 */
export async function classifyCapability(capabilityId, mode) {
  let getCapabilities;
  try {
    ({ getCapabilities } = await import('../mode-capabilities.mjs'));
  } catch {
    getCapabilities = () => [];
  }
  return classifyCapabilitySync(capabilityId, getCapabilities(mode));
}

/**
 * classifyCapabilitySync(capabilityId, caps)
 *
 * Synchronous variant that accepts a pre-fetched capabilities array. Avoids
 * dynamic import overhead in hot paths (e.g., batch diagnosis loops).
 */
export function classifyCapabilitySync(capabilityId, caps) {
  const cap = (caps ?? []).find((c) => c.id === capabilityId);
  if (!cap) return 'not-implemented';
  if (cap.status === 'implemented') return 'implemented';
  if (cap.status === 'stub') return 'stub';
  return 'not-implemented';
}

/**
 * diagnosisLevelForCapability(classification)
 *
 * Maps a classifyCapabilitySync result to the doctor diagnosis level:
 *   'implemented'     → 'healthy'  (green)
 *   'stub'            → 'stub'     (yellow ~ icon)
 *   'not-implemented' → 'stub'     (yellow ~ icon, "Not implemented" message)
 */
export function diagnosisLevelForCapability(classification) {
  if (classification === 'implemented') return 'healthy';
  return 'stub';
}

/**
 * diagnosisMessageForCapability(classification)
 *
 * Returns the human-readable message for a capability diagnosis entry.
 */
export function diagnosisMessageForCapability(classification) {
  if (classification === 'implemented') return 'Fully implemented';
  if (classification === 'stub') return 'Partial implementation';
  return 'Not implemented';
}

/**
 * renderDiagnosisLevel(level)
 *
 * Returns the display icon for a given diagnosis level. Renderers that format
 * doctor output should use this rather than embedding icon logic inline.
 *
 * Level → icon mapping:
 *   'healthy'  → '✓'
 *   'degraded' → '⚠'
 *   'stub'     → '~'
 *   anything else → '✗'
 */
export function renderDiagnosisLevel(level) {
  if (level === 'healthy') return '✓';
  if (level === 'degraded') return '⚠';
  if (level === 'stub') return STUB_ICON;
  return '✗';
}
