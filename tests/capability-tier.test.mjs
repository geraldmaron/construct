/**
 * capability-tier.test.mjs — Unit tests for resolveCapabilityTier and the small-model
 * profile size inference in lib/model-router.mjs.
 *
 * Covers: cloud models get the full persona, local size maps to floor/mid, a COLLAPSED
 * probe verdict forces floor, unknown local size is conservative (floor), and the
 * size-marker regex now matches 24b/30b (the prior fixed list missed them).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveCapabilityTier, resolveModelOperatingProfile, selectLocalEditorModel } from "../lib/model-router.mjs";

test("cloud models always render the full persona", () => {
  assert.equal(resolveCapabilityTier({ model: "anthropic/claude-opus-4-6" }), "full");
  assert.equal(resolveCapabilityTier({ model: "openrouter/qwen/qwen3-coder:free" }), "full");
});

test("empty / unknown model is treated as full (cloud-safe default)", () => {
  assert.equal(resolveCapabilityTier({ model: "" }), "full");
  assert.equal(resolveCapabilityTier({}), "full");
});

test("small local model maps to floor, mid-size local to mid", () => {
  assert.equal(resolveCapabilityTier({ model: "ollama/qwen2.5-coder:7b-cx32k" }), "floor");
  assert.equal(resolveCapabilityTier({ model: "ollama/devstral:24b-cx32k" }), "mid");
  assert.equal(resolveCapabilityTier({ model: "ollama/qwen3-coder:30b-cx32k" }), "mid");
});

test("COLLAPSED verdict forces floor regardless of size", () => {
  assert.equal(resolveCapabilityTier({ model: "ollama/qwen3-coder:30b-cx32k", verdict: "COLLAPSED" }), "floor");
});

test("local model with no size marker is conservative (floor)", () => {
  assert.equal(resolveCapabilityTier({ model: "ollama/some-model:latest" }), "floor");
});

test("size regex now matches 24b/30b for the small operating profile", () => {
  assert.equal(resolveModelOperatingProfile({ selectedModel: "ollama/devstral:24b-cx32k" }).id, "small");
  assert.equal(resolveModelOperatingProfile({ selectedModel: "ollama/qwen3-coder:30b-cx32k" }).id, "small");
  assert.equal(resolveModelOperatingProfile({ selectedModel: "ollama/qwen2.5-coder:7b-cx32k" }).id, "small");
});

test("large cloud model keeps the balanced profile", () => {
  assert.equal(resolveModelOperatingProfile({ selectedModel: "anthropic/claude-opus-4-6" }).id, "balanced");
});

test("editor selection prefers the smallest in-band code model", () => {
  const inv = [
    "ollama/llama3.2:latest-cx32k",
    "ollama/qwen2.5-coder:7b-cx32k",
    "ollama/devstral:24b-cx32k",
    "ollama/qwen3-coder:30b-cx32k",
  ];
  assert.equal(selectLocalEditorModel(inv), "ollama/qwen2.5-coder:7b-cx32k");
});

test("editor selection prefers a code model over a smaller generalist", () => {
  assert.equal(
    selectLocalEditorModel(["ollama/llama3.2:3b", "ollama/qwen2.5-coder:7b-cx32k"]),
    "ollama/qwen2.5-coder:7b-cx32k",
  );
});

test("editor selection uses a large coder when no in-band coder exists", () => {
  assert.equal(selectLocalEditorModel(["ollama/qwen3-coder:30b-cx32k"]), "ollama/qwen3-coder:30b-cx32k");
});

test("editor selection falls back to a generalist only when no coder is present", () => {
  assert.equal(selectLocalEditorModel(["ollama/llama3.2:latest-cx32k"]), "ollama/llama3.2:latest-cx32k");
});

test("editor selection returns null with no candidates (caller keeps its fallback)", () => {
  assert.equal(selectLocalEditorModel([]), null);
});
