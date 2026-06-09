/**
 * tests/capabilities/orchestration.routing/opencode.test.mjs
 *
 * Deterministic guard for the local-model orchestration path on OpenCode. Small
 * models can only orchestrate when their request payload survives the
 * OpenAI-compatible /v1 boundary: a real context window comes from a Modelfile
 * variant (not opencode.json), and only boundary-surviving sampler params are
 * emitted. Asserts those invariants on the real config writer and provisioner —
 * no Ollama or LLM required (see tests/e2e/local-model-ab.mjs for the live A/B).
 */
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeOpenCodeConfig } from "../../../lib/opencode-config.mjs";
import { variantName, buildModelfile } from "../../../lib/ollama/provision-context.mjs";

test("opencode config drops /v1-incompatible Ollama params for local models", () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-cfg-"));
  const file = join(dir, "opencode.json");
  try {
    writeOpenCodeConfig({
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://127.0.0.1:11434/v1" },
          models: {
            "qwen2.5-coder:7b-cx32k": {
              name: "qwen2.5-coder:7b-cx32k",
              options: { temperature: 0.1, num_ctx: 8192, repeat_penalty: 1.15, frequency_penalty: 0.5 },
            },
          },
        },
      },
    }, file);

    const written = JSON.parse(readFileSync(file, "utf8"));
    const opts = written.provider.ollama.models["qwen2.5-coder:7b-cx32k"].options;

    assert.equal(opts.num_ctx, undefined, "num_ctx is dropped (ignored over /v1)");
    assert.equal(opts.repeat_penalty, undefined, "repeat_penalty is dropped (Ollama-specific)");
    assert.equal(opts.frequency_penalty, undefined, "frequency_penalty is never emitted");
    assert.equal(opts.presence_penalty, undefined, "presence_penalty is never emitted");
    assert.equal(opts.temperature, 0.1, "temperature survives (OpenAI-standard)");
    assert.ok(Array.isArray(opts.stop) && opts.stop.includes("<|im_end|>"), "ChatML stop tokens emitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("context variant naming preserves the original tag", () => {
  assert.equal(variantName("qwen2.5-coder:7b", 32768), "qwen2.5-coder:7b-cx32k");
  assert.equal(variantName("llama3.2:latest", 16384), "llama3.2:latest-cx16k");
  assert.equal(variantName("mistral", 32768), "mistral:cx32k");
});

test("Modelfile bakes the real context window and sampler settings", () => {
  const mf = buildModelfile("qwen2.5-coder:7b", 32768);
  assert.match(mf, /^FROM qwen2\.5-coder:7b$/m);
  assert.match(mf, /PARAMETER num_ctx 32768/);
  assert.match(mf, /PARAMETER repeat_penalty/);
  assert.match(mf, /PARAMETER stop "<\|im_end\|>"/);
});
