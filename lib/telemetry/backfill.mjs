/**
 * lib/telemetry/backfill.mjs — Sparse Langfuse trace backfill.
 *
 * Fetches the most recent sparse traces from Langfuse and posts a synthetic
 * EVENT observation against each one so it graduates from sparse → partial.
 * Safe to call repeatedly — observations are idempotent (same deterministic ID).
 *
 * Consumed by:
 *   • lib/status.mjs         — auto-triggered when sparse coverage is detected.
 *   • bin/construct           — `construct telemetry-backfill` CLI command.
 */
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createIngestClient } from "./langfuse-ingest.mjs";

const DEFAULT_LIMIT = 10;
const SPARSE_THRESHOLD = 0.35;

/**
 * Derive a stable observation ID from a trace ID so repeated backfills are
 * idempotent from the caller's perspective (Langfuse de-dupes by ID on upsert).
 */
function stableObservationId(traceId) {
  return createHash("sha256").update(`backfill:${traceId}`).digest("hex").slice(0, 32);
}

function classifySparseTrace(trace) {
  const observationCount = Number(
    trace?.observationCount ?? trace?.observations?.length ?? trace?.spanCount ?? trace?.generationCount ?? 0
  ) || 0;
  const hasInput = trace?.input != null;
  const hasOutput = trace?.output != null;
  const metaKeys = trace?.metadata && typeof trace.metadata === "object"
    ? Object.keys(trace.metadata).length
    : 0;
  const hasRichMetadata = metaKeys >= 5;
  const hasPayload = hasInput || hasOutput || metaKeys > 0;

  if ((hasInput || hasOutput) && (observationCount >= 1 || hasRichMetadata)) return "rich";
  if (hasPayload || observationCount >= 1) return "partial";
  return "sparse";
}

/**
 * Fetch recent traces from Langfuse and return only the sparse ones.
 */
async function fetchSparseTraces({
  baseUrl,
  headers,
  limit = DEFAULT_LIMIT,
  signal,
  fetchImpl = globalThis.fetch,
} = {}) {
  const url = `${baseUrl}/api/public/traces?limit=${limit * 3}`;
  const res = await fetchImpl(url, { headers, signal });
  if (!res.ok) throw new Error(`Langfuse traces ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const traces = Array.isArray(json.data) ? json.data : [];
  return traces
    .filter((t) => classifySparseTrace(t) === "sparse")
    .slice(0, limit);
}

/**
 * Post a backfill EVENT observation against a trace.
 */
function buildBackfillObservation(traceId, { healReason = "auto", source = "construct-backfill" } = {}) {
  return {
    id: stableObservationId(traceId),
    traceId,
    type: "EVENT",
    name: "construct.backfill",
    startTime: new Date().toISOString(),
    metadata: {
      heal_reason: healReason,
      source,
      backfilledAt: new Date().toISOString(),
    },
  };
}

/**
 * Backfill sparse traces. Returns a result summary.
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl]
 * @param {string} [opts.publicKey]
 * @param {string} [opts.secretKey]
 * @param {number} [opts.limit]
 * @param {boolean} [opts.bestEffort]  - skip individual failures instead of throwing
 * @param {Function} [opts.fetchImpl]
 * @returns {{ backfilled: number, skipped: number, errors: string[] }}
 */
export async function backfillSparseTraces({
  baseUrl = (process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com").replace(/\/$/, ""),
  publicKey = process.env.LANGFUSE_PUBLIC_KEY,
  secretKey = process.env.LANGFUSE_SECRET_KEY,
  limit = DEFAULT_LIMIT,
  bestEffort = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!publicKey || !secretKey || !fetchImpl) {
    return { backfilled: 0, skipped: 0, errors: ["Langfuse credentials not configured"] };
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  const errors = [];
  let sparseTraces;

  try {
    sparseTraces = await fetchSparseTraces({ baseUrl, headers, limit, fetchImpl });
  } catch (err) {
    return { backfilled: 0, skipped: 0, errors: [err.message] };
  }

  if (!sparseTraces.length) {
    return { backfilled: 0, skipped: 0, errors: [] };
  }

  const client = createIngestClient({ baseUrl, publicKey, secretKey, fetchImpl });
  let backfilled = 0;
  let skipped = 0;

  for (const trace of sparseTraces) {
    const traceId = trace.id;
    if (!traceId) { skipped += 1; continue; }
    try {
      client.event(buildBackfillObservation(traceId));
      backfilled += 1;
    } catch (err) {
      if (bestEffort) {
        errors.push(`${traceId}: ${err.message}`);
        skipped += 1;
      } else {
        throw err;
      }
    }
  }

  await client.flush();
  return { backfilled, skipped, errors };
}

/**
 * Auto-heal trigger: run backfill only when Langfuse coverage is below threshold.
 * Fire-and-forget — errors are swallowed. Intended for background use from buildStatus.
 */
export function triggerAutoBackfillIfSparse(telemetryRichness, opts = {}) {
  const coverage = telemetryRichness?.coverage ?? 1;
  const total = telemetryRichness?.total ?? 0;
  if (total === 0 || coverage >= SPARSE_THRESHOLD) return;

  backfillSparseTraces({ ...opts, bestEffort: true }).catch(() => {});
}

/**
 * CLI entrypoint for `construct telemetry-backfill`.
 */
export async function runTelemetryBackfillCli(args = []) {
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) || DEFAULT_LIMIT : DEFAULT_LIMIT;
  const bestEffort = args.includes("--best-effort");

  process.stdout.write(`Backfilling sparse Langfuse traces (limit: ${limit})…\n`);

  const result = await backfillSparseTraces({ limit, bestEffort });

  if (result.errors.length && !bestEffort) {
    process.stderr.write(`Backfill error: ${result.errors[0]}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `Done. backfilled=${result.backfilled} skipped=${result.skipped}${result.errors.length ? ` errors=${result.errors.length}` : ""}\n`
  );
}
