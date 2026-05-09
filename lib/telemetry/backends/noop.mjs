/**
 * lib/telemetry/backends/noop.mjs — No-op trace backend for when no backend is configured.
 *
 * Returns empty results for all queries. Useful for local debug logging and
 * environments where telemetry is optional.
 */

export const name = 'noop';

export async function listTraces(_teamId, _windowMs) {
  return [];
}

export async function isAvailable() {
  return true;
}
