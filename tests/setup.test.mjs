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
import { tempDir } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const setup = await import(path.join(root, "lib", "setup.mjs"));
const { postgresPort, postgresContainerName } = await import(path.join(root, "lib", "home-namespace.mjs"));

test("managed setup values configure local vector and local trace defaults", async () => {
  const home = tempDir("construct-setup-values-");
  // Pin embedding model to hashing in tests so the expected CONSTRUCT_VECTOR_MODEL
  // value is deterministic without requiring the ONNX runtime.
  const values = await setup.buildManagedSetupValues({
    homeDir: home,
    env: { CONSTRUCT_EMBEDDING_MODEL: "hashing" },
  });

  assert.equal(values.CONSTRUCT_TRACE_BACKEND, "local");
  assert.equal(values.CONSTRUCT_TELEMETRY_URL, undefined, "no default telemetry URL — user must configure");
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "hashing-bow-v1");
  assert.equal(values.CONSTRUCT_VECTOR_INDEX_PATH, path.join(home, ".construct", "vector", "index.json"));
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_ENABLED, "1");
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_INTERVAL_SECONDS, "300");
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_SWAP_GB, "6");
  assert.equal(values.DATABASE_URL, undefined);
});

test("managed setup values respect explicit remote telemetry URL", async () => {
  const home = tempDir("construct-setup-remote-telemetry-");
  const values = await setup.buildManagedSetupValues({
    homeDir: home,
    env: {
      CONSTRUCT_EMBEDDING_MODEL: "hashing",
      CONSTRUCT_TELEMETRY_URL: "https://telemetry.acme.example",
      CONSTRUCT_TELEMETRY_PUBLIC_KEY: "pk-acme",
      CONSTRUCT_TELEMETRY_SECRET_KEY: "sk-acme",
    },
  });
  assert.equal(values.CONSTRUCT_TELEMETRY_URL, "https://telemetry.acme.example");
  assert.equal(values.CONSTRUCT_TELEMETRY_PUBLIC_KEY, "pk-acme");
  assert.equal(values.CONSTRUCT_TELEMETRY_SECRET_KEY, "sk-acme");
});

test("managed setup values preserve caller-provided external services", async () => {
  const home = tempDir("construct-setup-external-");
  const values = await setup.buildManagedSetupValues({
    homeDir: home,
    env: {
      DATABASE_URL: "postgresql://db.example/construct",
      CONSTRUCT_VECTOR_URL: "https://vector.example",
      CONSTRUCT_VECTOR_MODEL: "external-model",
      CONSTRUCT_TELEMETRY_URL: "https://telemetry.example",
      CONSTRUCT_TELEMETRY_PUBLIC_KEY: "pk-test",
      CONSTRUCT_TELEMETRY_SECRET_KEY: "sk-test",
    },
  });

  assert.equal(values.DATABASE_URL, "postgresql://db.example/construct");
  assert.equal(values.CONSTRUCT_VECTOR_URL, "https://vector.example");
  assert.equal(values.CONSTRUCT_VECTOR_MODEL, "external-model");
  assert.equal(values.CONSTRUCT_TELEMETRY_URL, "https://telemetry.example");
  assert.equal(values.CONSTRUCT_TELEMETRY_PUBLIC_KEY, "pk-test");
  assert.equal(values.CONSTRUCT_TELEMETRY_SECRET_KEY, "sk-test");
  assert.equal(values.CONSTRUCT_PRESSURE_GUARD_ENABLED, "1");
});

test("local Postgres compose file is per-home-namespaced and scoped to localhost", () => {
  const home = tempDir("construct-setup-compose-");
  const composePath = setup.writeLocalPostgresCompose(home);
  const content = fs.readFileSync(composePath, "utf8");
  const container = postgresContainerName(process.env, home);
  const port = postgresPort(process.env, home);

  assert.equal(composePath, path.join(home, ".construct", "services", "postgres", "docker-compose.yml"));
  assert.match(content, /image: pgvector\/pgvector:pg16/);
  assert.match(content, new RegExp(`container_name: ${container}`));
  assert.match(content, new RegExp(`"127\\.0\\.0\\.1:${port}:5432"`));
  assert.match(content, new RegExp(`${container}-data`));
  assert.equal(content, fs.readFileSync(setup.writeLocalPostgresCompose(home), "utf8"), "deterministic for a given home");
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
  assert.equal(result.databaseUrl, `postgresql://construct:construct@127.0.0.1:${postgresPort({}, home)}/construct`);
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

test("dockerInstallHint returns platform-specific guidance", () => {
  const macHint = setup.dockerInstallHint('darwin');
  assert.match(macHint, /Docker Desktop/);
  assert.match(macHint, /OrbStack|Colima/, "macOS hint surfaces the lightweight alternatives");

  const winHint = setup.dockerInstallHint('win32');
  assert.match(winHint, /Docker Desktop for Windows/);

  const linuxHint = setup.dockerInstallHint('linux');
  assert.match(linuxHint, /Docker Engine/);
  assert.match(linuxHint, /apt|dnf|pacman/, "Linux hint mentions the package managers users will reach for");
});

test("ensureLibSymlink creates ~/.construct/lib pointing at the install lib/", () => {
  const home = tempDir("construct-libsymlink-");
  const fakeRoot = tempDir("construct-libsymlink-root-");
  fs.mkdirSync(path.join(fakeRoot, 'lib'), { recursive: true });

  const result = setup.ensureLibSymlink({ homeDir: home, rootDir: fakeRoot });

  assert.equal(result.status, "created");
  const target = path.join(home, '.construct', 'lib');
  assert.ok(fs.lstatSync(target).isSymbolicLink());
  assert.equal(fs.readlinkSync(target), path.join(fakeRoot, 'lib'));
});

test("ensureLibSymlink is idempotent: matching symlink is kept", () => {
  const home = tempDir("construct-libsymlink-keep-");
  const fakeRoot = tempDir("construct-libsymlink-keep-root-");
  fs.mkdirSync(path.join(fakeRoot, 'lib'), { recursive: true });

  setup.ensureLibSymlink({ homeDir: home, rootDir: fakeRoot });
  const second = setup.ensureLibSymlink({ homeDir: home, rootDir: fakeRoot });

  assert.equal(second.status, "kept");
});

test("ensureLibSymlink replaces a stale symlink pointing elsewhere", () => {
  const home = tempDir("construct-libsymlink-stale-");
  const fakeRoot = tempDir("construct-libsymlink-stale-root-");
  const stalePoint = tempDir("construct-libsymlink-stale-point-");
  fs.mkdirSync(path.join(fakeRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });
  fs.symlinkSync(stalePoint, path.join(home, '.construct', 'lib'), 'dir');

  const result = setup.ensureLibSymlink({ homeDir: home, rootDir: fakeRoot });

  assert.equal(result.status, "replaced");
  assert.equal(fs.readlinkSync(path.join(home, '.construct', 'lib')), path.join(fakeRoot, 'lib'));
});

test("ensureLibSymlink refuses to overwrite a real directory at the target", () => {
  const home = tempDir("construct-libsymlink-conflict-");
  const fakeRoot = tempDir("construct-libsymlink-conflict-root-");
  fs.mkdirSync(path.join(fakeRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(home, '.construct', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(home, '.construct', 'lib', 'sentinel.txt'), 'do not delete');

  const result = setup.ensureLibSymlink({ homeDir: home, rootDir: fakeRoot });

  assert.equal(result.status, "conflict");
  assert.ok(fs.existsSync(path.join(home, '.construct', 'lib', 'sentinel.txt')));
});
