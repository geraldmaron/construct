/**
 * lib/telemetry/backends/remote.mjs — Remote telemetry backend adapter.
 *
 * Reads CONSTRUCT_TELEMETRY_URL, CONSTRUCT_TELEMETRY_PUBLIC_KEY,
 * CONSTRUCT_TELEMETRY_SECRET_KEY from env.
 * Implements the TraceBackend interface: listTraces(teamId, windowMs) → Trace[].
 *
 * The HTTP protocol is compatible with open trace ingestion APIs.
 * Point CONSTRUCT_TELEMETRY_URL at any compatible backend.
 */

export const name = 'remote';

export function telemetryHeaders(env = process.env) {
  const key = env.CONSTRUCT_TELEMETRY_PUBLIC_KEY;
  const secret = env.CONSTRUCT_TELEMETRY_SECRET_KEY;
  if (!key || !secret)
    throw new Error(
      'CONSTRUCT_TELEMETRY_PUBLIC_KEY and CONSTRUCT_TELEMETRY_SECRET_KEY must be set.',
    );
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

export function telemetryBaseUrl(env = process.env) {
  return (env.CONSTRUCT_TELEMETRY_URL ?? '').replace(/\/$/, '');
}

export async function isAvailable() {
  return Boolean(
    (process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY) &&
      (process.env.CONSTRUCT_TELEMETRY_SECRET_KEY),
  );
}

/**
 * Fetch traces associated with a teamId within a time window.
 * Returns an array of normalized Trace objects.
 *
 * @param {string} teamId - The overlay/team ID to filter by.
 * @param {number} windowMs - Lookback window in milliseconds.
 * @returns {Promise<Trace[]>}
 */
export async function listTraces(teamId, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const base = telemetryBaseUrl();
  const url = `${base}/api/public/traces?tags=${encodeURIComponent(teamId)}&fromTimestamp=${since}&limit=100`;

  const resp = await fetch(url, { headers: telemetryHeaders() });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telemetry backend API error ${resp.status}: ${body}`);
  }
  const json = await resp.json();

  return (json.data ?? []).map((t) => ({
    id: t.id,
    teamId,
    agentName: t.metadata?.agentName ?? t.name ?? 'unknown',
    status: t.metadata?.status ?? 'unknown',
    latencyMs: t.latency != null ? Math.round(t.latency * 1000) : null,
    qualityScore: t.scores?.find((s) => s.name === 'quality')?.value ?? null,
    createdAt: t.timestamp,
    blockers: t.metadata?.blockers ?? [],
    handoffs: t.metadata?.handoffs ?? 0,
  }));
}


