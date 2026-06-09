/**
 * local-model-doctor.functional.test.mjs — bead construct-hjdk.
 *
 * Validates the two building blocks `construct doctor` uses for local-model
 * guidance, hermetically: probeAgenticCoherence's COHERENT/COLLAPSED
 * classification (driven against an in-process /v1 stub, no real Ollama) and
 * describeDoclingRuntime's provisioned/absent detection (a fresh runtime dir).
 */
import test from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeAgenticCoherence } from "../../lib/ollama/provision-context.mjs";
import { describeDoclingRuntime } from "../../lib/runtime/uv-bootstrap.mjs";

function stubV1(message) {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ baseURL: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test("probe classifies a coherent tool-calling response as COHERENT", async () => {
  const stub = await stubV1({ content: "", tool_calls: [{ function: { name: "read", arguments: "{}" } }] });
  try {
    const r = await probeAgenticCoherence("any-model", { baseURL: stub.baseURL });
    assert.equal(r.ok, true);
    assert.equal(r.coherent, true, "tool call => coherent");
  } finally {
    await stub.close();
  }
});

test("probe classifies repetition collapse as COLLAPSED", async () => {
  const stub = await stubV1({ content: "given given given given given given given given given given" });
  try {
    const r = await probeAgenticCoherence("any-model", { baseURL: stub.baseURL });
    assert.equal(r.ok, true);
    assert.equal(r.coherent, false, "immediate-repeat word salad => collapsed");
    assert.ok(r.repeatRatio >= 0.25, `repeatRatio should be high, got ${r.repeatRatio}`);
  } finally {
    await stub.close();
  }
});

test("describeDoclingRuntime reports a fresh runtime dir as not provisioned", () => {
  const dir = mkdtempSync(join(tmpdir(), "docling-rt-"));
  try {
    const d = describeDoclingRuntime({ runtimeDir: dir });
    assert.equal(d.available, false, "no venv => not available");
    assert.equal(d.marker, null, "no install marker yet");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
