/**
 * lib/telemetry/eval-datasets.mjs — Langfuse eval dataset writer.
 *
 * Reads recent scored traces from Langfuse, groups them by agent + workCategory,
 * and upserts structured dataset items so prompt changes can be evaluated in
 * the Langfuse UI using the Datasets feature.
 *
 * One dataset per agent (e.g. "construct-cx-engineer"). Each dataset item is one
 * trace: input = agent goal, expected_output = score+comment, metadata = promptHash.
 *
 * This closes the loop:
 *   agent runs → cx_score called → score written to Langfuse
 *   → eval-datasets job reads scores → upserts dataset items
 *   → Langfuse Datasets UI shows score distribution per prompt version
 *   → prompt author can see whether a change improved or regressed quality
 *
 * Consumed by:
 *   • lib/embed/daemon.mjs  — scheduled every 6h as 'eval-dataset-sync' job
 *   • bin/construct          — `construct eval-datasets` CLI command
 */

const MAX_TRACES = 100;
const MIN_SCORE_TO_INCLUDE = 0;   // include all scores — 0.0 failures are valuable

function baseHeaders(publicKey, secretKey) {
  return {
    Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl(env = process.env) {
  return (env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

/**
 * Fetch recent traces that have at least one quality score.
 * Returns array of { traceId, name, input, metadata, scores[] }.
 */
async function fetchScoredTraces({ url, headers, limit = MAX_TRACES, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${url}/api/public/scores?name=quality&limit=${limit}`, { headers });
  if (!res.ok) throw new Error(`Langfuse scores fetch ${res.status}`);
  const json = await res.json().catch(() => ({}));
  const scores = Array.isArray(json.data) ? json.data : [];
  if (!scores.length) return [];

  // De-duplicate by traceId — take the latest score per trace
  const byTrace = new Map();
  for (const score of scores) {
    if (!score.traceId) continue;
    const existing = byTrace.get(score.traceId);
    if (!existing || new Date(score.timestamp) > new Date(existing.timestamp)) {
      byTrace.set(score.traceId, score);
    }
  }

  // Fetch trace details in parallel (up to 10 at a time)
  const traceIds = [...byTrace.keys()].slice(0, limit);
  const BATCH = 10;
  const enriched = [];
  for (let i = 0; i < traceIds.length; i += BATCH) {
    const batch = traceIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((id) =>
        fetchImpl(`${url}/api/public/traces/${id}`, { headers })
          .then((r) => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );
    for (let j = 0; j < batch.length; j++) {
      const trace = results[j].status === 'fulfilled' ? results[j].value : null;
      if (!trace) continue;
      const score = byTrace.get(batch[j]);
      enriched.push({ trace, score });
    }
  }
  return enriched;
}

/**
 * Upsert a dataset item in Langfuse.
 * Creates the dataset if it doesn't exist (Langfuse returns 200 on existing datasets).
 */
async function upsertDatasetItem({ url, headers, datasetName, item, fetchImpl = globalThis.fetch }) {
  // Create dataset (idempotent)
  await fetchImpl(`${url}/api/public/datasets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: datasetName, description: `Auto-generated eval dataset for ${datasetName}` }),
  }).catch(() => {});

  // Upsert item — use traceId as the stable ID so reruns are idempotent
  const res = await fetchImpl(`${url}/api/public/dataset-items`, {
    method: 'POST',
    headers,
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`dataset-items ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Derive a dataset name from a trace.
 * Uses agentName from trace metadata, falling back to trace.name.
 */
function datasetNameForTrace(trace) {
  const agent = trace?.metadata?.agentName || trace?.name || 'construct';
  const workCategory = trace?.metadata?.routeWorkCategory || null;
  const base = `construct-${agent}`;
  return workCategory ? `${base}-${workCategory}` : base;
}

/**
 * Main entrypoint. Reads scored traces from Langfuse and upserts dataset items.
 * Returns { synced, skipped, errors }.
 */
export async function syncEvalDatasets({
  publicKey = process.env.LANGFUSE_PUBLIC_KEY,
  secretKey = process.env.LANGFUSE_SECRET_KEY,
  env = process.env,
  limit = MAX_TRACES,
  bestEffort = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!publicKey || !secretKey) {
    return { synced: 0, skipped: 0, errors: ['Langfuse credentials not configured'] };
  }

  const url = baseUrl(env);
  const headers = baseHeaders(publicKey, secretKey);
  const errors = [];
  let synced = 0;
  let skipped = 0;

  let scoredTraces;
  try {
    scoredTraces = await fetchScoredTraces({ url, headers, limit, fetchImpl });
  } catch (err) {
    return { synced: 0, skipped: 0, errors: [err.message] };
  }

  for (const { trace, score } of scoredTraces) {
    try {
      const datasetName = datasetNameForTrace(trace);
      const promptHash = trace?.metadata?.composedPromptHash ?? null;
      const promptVersion = trace?.metadata?.composedPromptVersion ?? null;

      const item = {
        // Use traceId as external ID so upserts are idempotent
        id: `trace-${trace.id}`,
        datasetName,
        input: trace.input ?? trace?.metadata?.goal ?? '',
        expectedOutput: {
          qualityScore: score.value,
          comment: score.comment ?? null,
          agentName: trace?.metadata?.agentName ?? trace?.name ?? null,
          workCategory: trace?.metadata?.routeWorkCategory ?? null,
        },
        metadata: {
          traceId: trace.id,
          traceName: trace.name,
          promptHash,
          promptVersion,
          routeIntent: trace?.metadata?.routeIntent ?? null,
          routeTrack: trace?.metadata?.routeTrack ?? null,
          fragmentTypes: trace?.metadata?.promptFragmentTypes ?? null,
          hasLearnedPatterns: trace?.metadata?.promptHasLearnedPatterns ?? false,
          scoredAt: score.timestamp ?? new Date().toISOString(),
        },
      };

      await upsertDatasetItem({ url, headers, datasetName, item, fetchImpl });
      synced += 1;
    } catch (err) {
      if (bestEffort) {
        errors.push(`${trace?.id}: ${err.message}`);
        skipped += 1;
      } else {
        throw err;
      }
    }
  }

  return { synced, skipped, errors };
}

/**
 * CLI entrypoint for `construct eval-datasets`.
 */
export async function runEvalDatasetsCli(args = []) {
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) || MAX_TRACES : MAX_TRACES;

  process.stdout.write(`Syncing eval datasets from Langfuse (limit: ${limit})…\n`);
  const result = await syncEvalDatasets({ limit, bestEffort: false });
  process.stdout.write(`Done. synced=${result.synced} skipped=${result.skipped}${result.errors.length ? ` errors=${result.errors.length}` : ''}\n`);
  if (result.errors.length) {
    for (const e of result.errors) process.stderr.write(`  ${e}\n`);
  }
}
