/**
 * tests/ingest-docling-fallback.test.mjs — docling timeout/failure fallback.
 *
 * The high-fidelity (docling) extractor provisions a Python venv and downloads ML
 * models on first use; a stall there hung `construct ingest` (CLI) and blocked the
 * ingest_document MCP tool until the client timed out with an opaque error.
 * extractWithDoclingFallback must bound the docling attempt and fall back to the
 * legacy extractor so ingest always returns a usable result, recording the
 * fallback in droppedInfo. Extractors are injected so no real docling/venv runs.
 */
import test from "node:test";
import assert from "node:assert";
import { withTimeout, extractWithDoclingFallback } from "../lib/document-ingest.mjs";

const legacyResult = () => ({ text: "legacy text", markdown: null, characters: 11, extractionMethod: "legacy", droppedInfo: [] });

test("withTimeout rejects a slow promise and resolves a fast one", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, "too slow"),
    /too slow/,
  );
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000, "x"), "ok");
});

test("docling timeout falls back to the legacy extractor with a recorded drop", async () => {
  const out = await extractWithDoclingFallback("/tmp/doc.pdf", {
    timeoutMs: 10,
    asyncExtract: () => new Promise(() => {}), // never resolves -> times out
    syncExtract: legacyResult,
  });
  assert.equal(out.extractionMethod, "legacy", "used the legacy extractor");
  const drop = out.droppedInfo.find((d) => d.kind === "docling-fallback");
  assert.ok(drop, "fallback recorded in droppedInfo");
  assert.match(drop.reason, /timed out|failed/);
});

test("docling error (e.g. provisioning failure) falls back to legacy", async () => {
  const out = await extractWithDoclingFallback("/tmp/doc.docx", {
    timeoutMs: 5000,
    asyncExtract: () => Promise.reject(new Error("uv install timed out")),
    syncExtract: legacyResult,
  });
  assert.equal(out.extractionMethod, "legacy");
  assert.ok(out.droppedInfo.some((d) => d.kind === "docling-fallback" && /uv install/.test(d.reason)));
});

test("docling success passes through unchanged (no fallback drop)", async () => {
  const doclingOut = { text: "docling md", markdown: "docling md", characters: 10, extractionMethod: "docling", droppedInfo: [] };
  const out = await extractWithDoclingFallback("/tmp/doc.pdf", {
    timeoutMs: 5000,
    asyncExtract: () => Promise.resolve(doclingOut),
    syncExtract: () => { throw new Error("legacy must not run on success"); },
  });
  assert.equal(out.extractionMethod, "docling");
  assert.equal(out.droppedInfo.some((d) => d.kind === "docling-fallback"), false);
});
