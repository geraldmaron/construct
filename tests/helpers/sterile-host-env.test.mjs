/**
 * tests/helpers/sterile-host-env.test.mjs — Validate the sterile host sandbox.
 *
 * Proves the sandbox exercises the real provisioning + config-write logic against
 * a stubbed Ollama and an isolated HOME, while the machine's real configs and
 * model store stay byte-identical. Guards against the failure mode this harness
 * exists to prevent: a test leaking writes into the user's actual tool configs.
 */
import test from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from "./sterile-host-env.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("provisioning runs against the stub, real Ollama + configs untouched", () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({
    ollamaModels: [
      { name: "qwen2.5-coder:7b", params: "7.6B", trainedCtx: 32768, tools: true, numCtx: null },
      { name: "deepseek-coder-v2:16b", params: "16B", trainedCtx: 16384, tools: false, numCtx: null },
    ],
  });

  try {
    // Exercise the real provisioner via the sandboxed PATH (stub ollama).
    const r = spawnSync(process.execPath, [join(repoRoot, "lib", "ollama", "provision-context.mjs"), "--num-ctx=32768"], {
      env: sandbox.env,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `provisioner exited non-zero: ${r.stderr}`);
    const out = JSON.parse(r.stdout);

    assert.equal(out.mapping["qwen2.5-coder:7b"], "qwen2.5-coder:7b-cx32k", "tool-capable model gets a variant");
    assert.equal(out.mapping["deepseek-coder-v2:16b"], undefined, "non-tool-capable model is skipped");

    // The variant landed in the SANDBOX ollama state, never the real store.
    const stubState = JSON.parse(readFileSync(sandbox.ollamaStateFile, "utf8"));
    assert.ok(stubState.models.some((m) => m.name === "qwen2.5-coder:7b-cx32k"), "variant recorded in sandbox state");

    // The load-bearing assertion: nothing outside the sandbox moved.
    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});

test("a write into the real config path is detected as a sterile violation", () => {
  // The guard must actually catch drift — fabricate a changed fingerprint and
  // confirm it throws, so a real leak cannot pass silently.

  const before = fingerprintRealConfigs();
  const tampered = { ...before, "ollama:list": "deadbeefdeadbeef" };
  assert.throws(() => assertRealConfigsUnchanged(tampered), /Sterile violation/);
});
