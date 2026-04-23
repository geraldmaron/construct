/**
 * lib/telemetry/langfuse-ingest.mjs — Langfuse batch ingestion client.
 *
 * POSTs observations to /api/public/ingestion in batches. Silent no-op when
 * LANGFUSE_PUBLIC_KEY/SECRET_KEY are missing. Never throws from the hot path.
 */
import { randomUUID } from "node:crypto";

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_MAX_BATCH = 50;
const MAX_PAYLOAD_CHARS = 16_000;

function truncate(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_PAYLOAD_CHARS
      ? `${value.slice(0, MAX_PAYLOAD_CHARS)}…[truncated ${value.length - MAX_PAYLOAD_CHARS} chars]`
      : value;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_PAYLOAD_CHARS) return value;
    return { _truncated: true, originalBytes: json.length, preview: json.slice(0, MAX_PAYLOAD_CHARS) };
  } catch {
    return value;
  }
}

export function createIngestClient({
  baseUrl = (process.env.LANGFUSE_BASEURL ?? "https://cloud.langfuse.com").replace(/\/$/, ""),
  publicKey = process.env.LANGFUSE_PUBLIC_KEY,
  secretKey = process.env.LANGFUSE_SECRET_KEY,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  maxBatch = DEFAULT_MAX_BATCH,
  onError = () => {},
  fetchImpl = globalThis.fetch,
} = {}) {
  const available = Boolean(publicKey && secretKey && fetchImpl);
  const queue = [];
  let flushTimer = null;
  let inflight = Promise.resolve();

  const authHeader = available
    ? `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`
    : "";

  function scheduleFlush() {
    if (!available || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBatch();
    }, flushIntervalMs);
    if (typeof flushTimer.unref === "function") flushTimer.unref();
  }

  async function flushBatch() {
    if (!available || queue.length === 0) return;
    const batch = queue.splice(0, maxBatch);
    const payload = JSON.stringify({ batch });
    const prev = inflight;
    inflight = (async () => {
      try { await prev; } catch { /* ignore prior */ }
      try {
        const res = await fetchImpl(`${baseUrl}/api/public/ingestion`, {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: payload,
        });
        if (!res.ok && res.status !== 207) {
          let detail = "";
          try { detail = (await res.text()).slice(0, 500); } catch { /* ignore */ }
          onError(new Error(`langfuse ingest ${res.status}: ${detail}`));
        }
      } catch (err) {
        onError(err);
      }
    })();
    if (queue.length >= maxBatch) scheduleFlush();
  }

  function push(type, body) {
    if (!available || !body) return;
    const cleaned = {
      ...body,
      input: body.input !== undefined ? truncate(body.input) : undefined,
      output: body.output !== undefined ? truncate(body.output) : undefined,
    };
    queue.push({ id: randomUUID(), type, timestamp: new Date().toISOString(), body: cleaned });
    if (queue.length >= maxBatch) { void flushBatch(); return; }
    scheduleFlush();
  }

  return {
    available,
    trace: (body) => push("trace-create", body),
    generation: (body) => push("generation-create", body),
    generationUpdate: (body) => push("generation-update", body),
    span: (body) => push("span-create", body),
    spanUpdate: (body) => push("span-update", body),
    event: (body) => push("event-create", body),
    async flush() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      while (queue.length > 0) await flushBatch();
      await inflight;
    },
    queueSize: () => queue.length,
  };
}
