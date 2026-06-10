/**
 * ollama-capability-store.test.mjs — local-model coherence verdict persistence (WS3).
 *
 * The probe writes a COHERENT/COLLAPSED verdict keyed by the model's Ollama digest;
 * sync and doctor read it without re-probing. These tests pin the rules that keep a
 * verdict honest: a transient probe failure never overwrites a real verdict, a
 * digest change marks a verdict stale, and a stale or unknown verdict never strands
 * a model as collapsed. Isolated via CX_HOME_OVERRIDE so no real store is touched.
 */
import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const collapsed = { ok: true, coherent: false, calledTool: false, repeatRatio: 0.97, uniqueRatio: 0.03 };
const coherent = { ok: true, coherent: true, calledTool: true, repeatRatio: 0.05, uniqueRatio: 0.9 };

async function withStore(fn) {
  const home = mkdtempSync(join(tmpdir(), "cx-capstore-"));
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = home;
  try {
    // Import fresh each time so the module-level cache and path resolve under the
    // overridden home for this case.
    const mod = await import(`../lib/ollama/capability-store.mjs?case=${encodeURIComponent(home)}`);
    await fn(mod);
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE; else process.env.CX_HOME_OVERRIDE = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

test("records a COLLAPSED verdict and reads it back", () => withStore(async (s) => {
  s.recordProbeResult("qwen2.5-coder:7b", collapsed, "digA");
  assert.equal(s.getModelVerdict("qwen2.5-coder:7b").verdict, "COLLAPSED");
  assert.ok(existsSync(s.localModelsPath()));
}));

test("a transient probe failure does not overwrite a real verdict", () => withStore(async (s) => {
  s.recordProbeResult("m", coherent, "digA");
  s.recordProbeResult("m", { ok: false, reason: "timeout" });
  assert.equal(s.getModelVerdict("m").verdict, "COHERENT");
}));

test("isKnownCollapsed is true only when the digest still matches", () => withStore(async (s) => {
  s.recordProbeResult("m", collapsed, "digA");
  assert.equal(s.isKnownCollapsed("m", "digA"), true);
  assert.equal(s.isKnownCollapsed("m", "digB"), false, "a re-pulled model is not stranded as collapsed");
  assert.equal(s.isKnownCollapsed("unknown", "digA"), false);
}));

test("a coherent model is never reported collapsed", () => withStore(async (s) => {
  s.recordProbeResult("m", coherent, "digA");
  assert.equal(s.isKnownCollapsed("m", "digA"), false);
}));

test("a verdict is stale when the digest changes or is absent", () => withStore(async (s) => {
  s.recordProbeResult("m", collapsed, "digA");
  assert.equal(s.isVerdictStale("m", "digA"), false);
  assert.equal(s.isVerdictStale("m", "digB"), true);
  assert.equal(s.isVerdictStale("m", null), true);
  assert.equal(s.isVerdictStale("absent", "digA"), true);
}));
