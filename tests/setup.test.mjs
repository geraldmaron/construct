/**
 * tests/setup.test.mjs — setup bootstrap regression tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tempDir } from './helpers.mjs';
import { stateDir } from '../lib/config/xdg.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const setup = await import(path.join(root, "lib", "setup.mjs"));

test("managed setup values configure local vector and local trace defaults", async () => {
  const home = tempDir("construct-setup-values-");
  const values = await setup.buildManagedSetupValues({
    homeDir: home,
    env: { CONSTRUCT_EMBEDDING_MODEL: "hashing" },
  });

  assert.equal(values.CONSTRUCT_TRACE_BACKEND, "local");
  assert.equal(values.CONSTRUCT_LANCEDB_PATH, path.join(stateDir(home), "vector", "lancedb"));
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "hashing-bow-v1");
});

test("managed setup values preserve caller-provided external services", async () => {
  const home = tempDir("construct-setup-external-");
  const values = await setup.buildManagedSetupValues({
    homeDir: home,
    env: {
      CONSTRUCT_LANCEDB_PATH: "/custom/lancedb",
      CONSTRUCT_VECTOR_MODEL: "external-model",
      CONSTRUCT_TELEMETRY_URL: "https://telemetry.example",
    },
  });

  assert.equal(values.CONSTRUCT_LANCEDB_PATH, "/custom/lancedb");
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "external-model");
  assert.equal(values.CONSTRUCT_TELEMETRY_URL, "https://telemetry.example");
});

test("cm installer skips when command already exists", () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    const checker = process.platform === 'win32' ? 'where' : 'which';
    if (command === checker && args[0] === "cm") return { status: 0, stdout: "/usr/local/bin/cm\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };

  const result = setup.ensureCmInstalled({ env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "available");
});
