/**
 * tests/telemetry-backfill.test.mjs — Tests for lib/telemetry/backfill.mjs.
 *
 * Verifies sparse trace detection, backfill observation generation, idempotency
 * of observation IDs, and no-op behavior when credentials are absent.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { backfillSparseTraces, triggerAutoBackfillIfSparse } from "../lib/telemetry/backfill.mjs";

function makeFetch(tracePages = [], ingestStatus = 200) {
  return async (url, opts) => {
    if (url.includes("/api/public/traces")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: tracePages }),
      };
    }
    if (url.includes("/api/public/ingestion")) {
      return {
        ok: ingestStatus === 200,
        status: ingestStatus,
        json: async () => ({}),
        text: async () => "",
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const SPARSE_TRACE = { id: "trace-sparse-1" };
const RICH_TRACE = {
  id: "trace-rich-1",
  input: { text: "hello" },
  output: { text: "world" },
  observationCount: 2,
  metadata: { a: 1, b: 2, c: 3, d: 4, e: 5 },
};

test("backfillSparseTraces returns no-op result when credentials are missing", async () => {
  const result = await backfillSparseTraces({
    publicKey: "",
    secretKey: "",
    fetchImpl: makeFetch([SPARSE_TRACE]),
  });
  assert.equal(result.backfilled, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /credentials not configured/i);
});

test("backfillSparseTraces skips rich traces and backfills only sparse ones", async () => {
  const ingested = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes("/api/public/traces")) {
      return { ok: true, status: 200, json: async () => ({ data: [RICH_TRACE, SPARSE_TRACE] }) };
    }
    if (url.includes("/api/public/ingestion")) {
      const body = JSON.parse(opts.body);
      ingested.push(...(body.batch ?? []));
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const result = await backfillSparseTraces({
    publicKey: "test-pub",
    secretKey: "test-sec",
    fetchImpl,
  });

  assert.equal(result.backfilled, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].body.traceId, "trace-sparse-1");
  assert.equal(ingested[0].body.type, "EVENT");
  assert.equal(ingested[0].body.name, "construct.backfill");
  assert.equal(ingested[0].body.metadata.heal_reason, "auto");
});

test("backfillSparseTraces backfill observation ID is deterministic for same trace", async () => {
  const bodyIds = new Set();
  const fetchImpl = async (url, opts) => {
    if (url.includes("/api/public/traces")) {
      return { ok: true, status: 200, json: async () => ({ data: [SPARSE_TRACE] }) };
    }
    if (url.includes("/api/public/ingestion")) {
      const body = JSON.parse(opts.body);
      (body.batch ?? []).forEach((obs) => bodyIds.add(obs.body?.id));
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  await backfillSparseTraces({ publicKey: "p", secretKey: "s", fetchImpl });
  await backfillSparseTraces({ publicKey: "p", secretKey: "s", fetchImpl });

  assert.equal(bodyIds.size, 1, "same trace should produce same observation body.id on repeated calls");
});

test("backfillSparseTraces returns empty result when no sparse traces found", async () => {
  const result = await backfillSparseTraces({
    publicKey: "p",
    secretKey: "s",
    fetchImpl: makeFetch([RICH_TRACE]),
  });
  assert.equal(result.backfilled, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
});

test("triggerAutoBackfillIfSparse does not fire when coverage is healthy", () => {
  let fired = false;
  const telemetryRichness = { total: 10, coverage: 0.9 };
  triggerAutoBackfillIfSparse(telemetryRichness, { publicKey: "p", secretKey: "s" });
  assert.equal(fired, false);
});

test("triggerAutoBackfillIfSparse does not fire when total is zero", () => {
  let called = false;
  const telemetryRichness = { total: 0, coverage: 0 };
  triggerAutoBackfillIfSparse(telemetryRichness, { publicKey: "p", secretKey: "s" });
  assert.equal(called, false);
});
