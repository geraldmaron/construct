/**
 * tests/setup.test.mjs — setup bootstrap regression tests.
 *
 * Verifies that unattended setup can produce managed local defaults without
 * requiring external services during tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const setup = await import(path.join(root, "lib", "setup.mjs"));

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("managed setup values configure local vector and Langfuse defaults", () => {
  const home = tempDir("construct-setup-values-");
  const values = setup.buildManagedSetupValues({ homeDir: home, env: {} });

  assert.equal(values.CONSTRUCT_TRACE_BACKEND, "langfuse");
  assert.equal(values.LANGFUSE_BASEURL, "https://cloud.langfuse.com");
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "hashing-bow-v1");
  assert.equal(values.CONSTRUCT_VECTOR_INDEX_PATH, path.join(home, ".construct", "vector", "index.json"));
  assert.equal(values.DATABASE_URL, undefined);
});

test("managed setup values preserve caller-provided external services", () => {
  const home = tempDir("construct-setup-external-");
  const values = setup.buildManagedSetupValues({
    homeDir: home,
    env: {
      DATABASE_URL: "postgresql://db.example/construct",
      CONSTRUCT_VECTOR_URL: "https://vector.example",
      CONSTRUCT_VECTOR_MODEL: "external-model",
      LANGFUSE_BASEURL: "https://langfuse.example",
      LANGFUSE_PUBLIC_KEY: "pk-test",
      LANGFUSE_SECRET_KEY: "sk-test",
    },
  });

  assert.equal(values.DATABASE_URL, "postgresql://db.example/construct");
  assert.equal(values.CONSTRUCT_VECTOR_URL, "https://vector.example");
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "external-model");
  assert.equal(values.LANGFUSE_BASEURL, "https://langfuse.example");
  assert.equal(values.LANGFUSE_PUBLIC_KEY, "pk-test");
  assert.equal(values.LANGFUSE_SECRET_KEY, "sk-test");
});

test("local Postgres compose file is deterministic and scoped to localhost", () => {
  const home = tempDir("construct-setup-compose-");
  const composePath = setup.writeLocalPostgresCompose(home);
  const content = fs.readFileSync(composePath, "utf8");

  assert.equal(composePath, path.join(home, ".construct", "services", "postgres", "docker-compose.yml"));
  assert.match(content, /image: postgres:16-alpine/);
  assert.match(content, /container_name: construct-postgres/);
  assert.match(content, /"127\.0\.0\.1:54329:5432"/);
  assert.match(content, /construct-postgres-data/);
});

test("managed Postgres startup skips cleanly when Docker is unavailable", () => {
  const home = tempDir("construct-setup-nodocker-");
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    return { status: 1, stdout: "", stderr: "docker unavailable" };
  };

  const result = setup.startManagedPostgres({ homeDir: home, env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "skipped");
  assert.equal(result.databaseUrl, "");
  assert.deepEqual(calls[0], ["docker", ["info"]]);
  assert.equal(fs.existsSync(setup.localPostgresComposePath(home)), false);
});

test("managed Postgres startup writes compose and returns local database URL", () => {
  const home = tempDir("construct-setup-docker-");
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: "ok", stderr: "" };
  };

  const result = setup.startManagedPostgres({ homeDir: home, env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "ok");
  assert.equal(result.databaseUrl, "postgresql://construct:construct@127.0.0.1:54329/construct");
  assert.equal(fs.existsSync(result.composePath), true);
  assert.deepEqual(calls[0], ["docker", ["info"]]);
  assert.deepEqual(calls[1], ["docker", ["compose", "version"]]);
  assert.deepEqual(calls[2], ["docker", ["compose", "-f", result.composePath, "up", "-d", "postgres"]]);
});

test("cm installer skips when command already exists", () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    if (command === "which" && args[0] === "cm") return { status: 0, stdout: "/usr/local/bin/cm\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };

  const result = setup.ensureCmInstalled({ env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "available");
  assert.deepEqual(calls, [["which", ["cm"]]]);
});

test("cm installer uses Homebrew when cm is missing", () => {
  const calls = [];
  let cmAvailable = false;
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    if (command === "which" && args[0] === "cm") {
      return cmAvailable
        ? { status: 0, stdout: "/opt/homebrew/bin/cm\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    if (command === "which" && args[0] === "brew") return { status: 0, stdout: "/opt/homebrew/bin/brew\n", stderr: "" };
    if (command === "brew" && args[0] === "install") {
      cmAvailable = true;
      return { status: 0, stdout: "installed\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };

  const result = setup.ensureCmInstalled({ env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "installed");
  assert.deepEqual(calls, [
    ["which", ["cm"]],
    ["which", ["brew"]],
    ["brew", ["install", "dicklesworthstone/tap/cm"]],
    ["which", ["cm"]],
  ]);
});

test("cm installer reports missing Homebrew when no install path is available", () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push([command, args]);
    return { status: 1, stdout: "", stderr: "" };
  };

  const result = setup.ensureCmInstalled({ env: {}, spawn: fakeSpawn });

  assert.equal(result.status, "missing");
  assert.equal(result.installCommand, "brew install dicklesworthstone/tap/cm");
  assert.deepEqual(calls, [
    ["which", ["cm"]],
    ["which", ["brew"]],
  ]);
});
