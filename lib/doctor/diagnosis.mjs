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
};
