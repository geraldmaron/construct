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

  it("should create annotation queue if missing", async () => {
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
    const postCall = calls.find(([, opts]) => opts?.method === "POST");
    assert.ok(postCall, "Expected a POST request");
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

  it("should create eval config if missing", async () => {
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
    assert.ok(seen.includes("POST"), "Expected at least one POST request");
  });
});
