/**
 * lib/telemetry/backends/langfuse.mjs — Langfuse trace backend adapter.
 *
 * Reads LANGFUSE_BASEURL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY from env.
 * Implements the TraceBackend interface: listTraces(teamId, windowMs) → Trace[].
 */

export const name = 'langfuse';

function baseHeaders() {
  const key = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!key || !secret) throw new Error('LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set.');
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl() {
  return (process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

export async function isAvailable() {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
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
  const url = `${baseUrl()}/api/public/traces?tags=${encodeURIComponent(teamId)}&fromTimestamp=${since}&limit=100`;

  const resp = await fetch(url, { headers: baseHeaders() });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Langfuse API error ${resp.status}: ${body}`);
  }
  const json = await resp.json();

  return (json.data ?? []).map((t) => ({
    id: t.id,
    teamId,
    agentName: t.metadata?.agentName ?? t.name ?? 'unknown',
    status: t.metadata?.status ?? 'unknown',
    latencyMs: t.latency != null ? Math.round(t.latency * 1000) : null, // Langfuse returns seconds
    qualityScore: t.scores?.find((s) => s.name === 'quality')?.value ?? null,
    createdAt: t.timestamp,
    blockers: t.metadata?.blockers ?? [],
    handoffs: t.metadata?.handoffs ?? 0,
  }));
}
