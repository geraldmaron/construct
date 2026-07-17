/**
 * tests/ingest-docling-fallback.test.mjs — docling timeout/failure fallback.
 *
 * The high-fidelity (docling) extractor provisions a Python venv and downloads ML
 * models on first use; a stall there hung `construct ingest` (CLI) and blocked the
 * ingest_document MCP tool until the client timed out with an opaque error.
 * extractWithDoclingFallback must bound the docling attempt and fall back to the
 * node-native extractor so ingest always returns a usable result, recording the
 * fallback in droppedInfo. Extractors are injected so no real docling/venv runs.
 */
import test from "node:test";
import assert from "node:assert";
import { withTimeout, extractWithDoclingFallback } from "../lib/document-ingest.mjs";

const nodeNativeResult = () => ({ text: "node-native text", markdown: null, characters: 16, extractionMethod: "unpdf", droppedInfo: [] });

test("withTimeout rejects a slow promise and resolves a fast one", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "too slow"),
    /too slow/,
  );
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "x"), "ok");
});

test("withTimeout invokes onTimeout when it fires, not when the promise settles first", async () => {
  let timeoutCalls = 0;
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "too slow", { onTimeout: () => { timeoutCalls += 1; } }),
    /too slow/,
  );
  assert.equal(timeoutCalls, 1);

  let settledCalls = 0;
  assert.equal(
    await withTimeout(Promise.resolve("ok"), 1000, "x", { onTimeout: () => { settledCalls += 1; } }),
    "ok",
  );
  assert.equal(settledCalls, 0, "onTimeout must not fire once the promise has already settled");
});

test("extractWithDoclingFallback signals its onTimeout hook on a timeout, not on a plain rejection", async () => {
  let timeoutSignalled = false;
  await extractWithDoclingFallback("/tmp/doc.pdf", {
    timeoutMs: 10,
    asyncExtract: () => new Promise(() => {}),
    nodeNativeExtract: async () => nodeNativeResult(),
    onTimeout: () => { timeoutSignalled = true; },
  });
  assert.equal(timeoutSignalled, true, "an abandoned docling attempt must be signalled so the caller can stop it");

  let signalledOnRejection = false;
  await extractWithDoclingFallback("/tmp/doc.docx", {
    timeoutMs: 5000,
    asyncExtract: () => Promise.reject(new Error("uv install timed out")),
    nodeNativeExtract: async () => ({ ...nodeNativeResult(), extractionMethod: "mammoth" }),
    onTimeout: () => { signalledOnRejection = true; },
  });
  assert.equal(signalledOnRejection, false, "a plain rejection (not a timeout) has nothing left to cancel");
});

test("docling timeout falls back to the node-native extractor with a recorded drop", async () => {
  const out = await extractWithDoclingFallback("/tmp/doc.pdf", {
    timeoutMs: 10,
    asyncExtract: () => new Promise(() => {}),
    nodeNativeExtract: async () => nodeNativeResult(),
  });
  assert.equal(out.extractionMethod, "unpdf", "used the node-native extractor");
  const drop = out.droppedInfo.find((d) => d.kind === "docling-fallback");
  assert.ok(drop, "fallback recorded in droppedInfo");
  assert.match(drop.reason, /timed out|failed/);
});

test("docling error (e.g. provisioning failure) falls back to node-native", async () => {
  const out = await extractWithDoclingFallback("/tmp/doc.docx", {
    timeoutMs: 5000,
    asyncExtract: () => Promise.reject(new Error("uv install timed out")),
    nodeNativeExtract: async () => ({ ...nodeNativeResult(), extractionMethod: "mammoth" }),
  });
  assert.equal(out.extractionMethod, "mammoth");
  assert.ok(out.droppedInfo.some((d) => d.kind === "docling-fallback" && /uv install/.test(d.reason)));
});

test("docling success passes through unchanged (no fallback drop)", async () => {
  const doclingOut = { text: "docling md", markdown: "docling md", characters: 10, extractionMethod: "docling", droppedInfo: [] };
  const out = await extractWithDoclingFallback("/tmp/doc.pdf", {
    timeoutMs: 5000,
    asyncExtract: () => Promise.resolve(doclingOut),
    nodeNativeExtract: async () => { throw new Error("node-native must not run on success"); },
  });
  assert.equal(out.extractionMethod, "docling");
  assert.equal(out.droppedInfo.some((d) => d.kind === "docling-fallback"), false);
});
