/**
 * lib/telemetry/langfuse-setup.test.mjs — Tests for langfuse-setup.mjs
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { runLangfuseSetup } from "../../lib/telemetry/langfuse-setup.mjs";

const MOCK_URL = "http://localhost:3000";

describe("langfuse-setup", () => {
  let mockFetch;
  let calls;

  beforeEach(() => {
    calls = [];
    mockFetch = (url, opts) => {
      calls.push([url, opts]);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
    };
  });

  it("should handle missing credentials gracefully", async () => {
    const result = await runLangfuseSetup({
      publicKey: "",
      secretKey: "",
      fetchImpl: mockFetch,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /LANGFUSE_PUBLIC_KEY/);
  });

  it("should skip creation when annotation queue is missing (read-only safe mode)", async () => {
    mockFetch = async (url, opts) => {
      calls.push([url, opts]);
      if (opts?.method === "POST") return { ok: true, json: () => Promise.resolve({}) };
      return { ok: true, json: () => Promise.resolve({ data: [] }) };
    };

    const result = await runLangfuseSetup({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    // Read-only mode: never POSTs to annotation-queues (avoids Langfuse ZodError crash)
    const annotationPost = calls.find(([url, opts]) => url?.includes('annotation-queues') && opts?.method === 'POST');
    assert.equal(annotationPost, undefined, "Should not POST to annotation-queues");
  });

  it("should skip queue and eval config if both exist", async () => {
    const methods = [];
    mockFetch = async (url, opts) => {
      methods.push(opts?.method || "GET");
      if (url.includes("annotation-queues")) {
        return { ok: true, json: () => Promise.resolve({ data: [{ name: "construct-quality-queue", metadata: { project: "construct", type: "quality" } }] }) };
      }
      return {
        ok: true,
        json: () => Promise.resolve({
          data: [{ name: "quality-llm-sonnet", model: "anthropic/claude-3-5-sonnet-20241022", prompt: "You are evaluating agent work quality.\n\nRate the work on a scale of 0.0 (complete failure) to 1.0 (perfect):\n\nCRITERIA:\n1. Task Completion (40%): Did it solve the stated problem?\n2. Requirements Adherence (30%): Followed all specs/constraints?\n3. Quality/Clarity (20%): Professional, well-structured?\n4. Thoroughness (10%): Complete coverage?\n\nInput: {{input}}\nExpected: {{expected_output}}\n\nRespond with JSON: {\"score\": 0.85, \"reason\": \"brief explanation\"}", metadata: { project: "construct", evaluator: "llm-sonnet" } }],
        }),
      };
    };

    const result = await runLangfuseSetup({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(methods, ["GET", "GET"]); // list queue + list eval, no creates/updates
  });

  it("should skip eval config creation when missing (read-only safe mode)", async () => {
    const seen = [];
    mockFetch = async (url, opts) => {
      seen.push(opts?.method || "GET");
      if (opts?.method === "POST") return { ok: true, json: () => Promise.resolve({}) };
      return { ok: true, json: () => Promise.resolve({ data: [] }) };
    };

    const result = await runLangfuseSetup({
      publicKey: "pk-test",
      secretKey: "sk-test",
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.ok(!seen.includes("POST"), "Should not POST (read-only safe mode)");
  });
});
