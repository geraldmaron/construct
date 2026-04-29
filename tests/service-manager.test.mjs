/**
 * service-manager.test.mjs — Unit tests for lib/service-manager.mjs process lifecycle and health checks.
 *
 * Covers: start/stop/restart, port allocation, health polling, and stash
 * and restore operations for the Postgres sidecar.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearDashboardState, readDashboardState, startServices, stopDashboard, getRuntimePorts, _verifyLangfuseKeys, _pruneStashDir } from '../lib/service-manager.mjs';
import { writeEnvValues } from '../lib/env-config.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('dashboard state is ignored when pid is no longer running', () => {
  const homeDir = tempDir('construct-service-home-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'dashboard.json'), `${JSON.stringify({ pid: 999999, port: 4242, url: 'http://127.0.0.1:4242' }, null, 2)}\n`);

  assert.equal(readDashboardState(homeDir), null);
});

test('stopDashboard clears stale state even when process is gone', () => {
  const homeDir = tempDir('construct-service-stop-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const statePath = path.join(runtimeDir, 'dashboard.json');
  fs.writeFileSync(statePath, `${JSON.stringify({ pid: 999999, port: 4242, url: 'http://127.0.0.1:4242' }, null, 2)}\n`);

  const result = stopDashboard(homeDir);
  assert.equal(result.stopped, false);
  assert.equal(result.reason, 'stale-state');
  assert.equal(fs.existsSync(statePath), false);
});

test('clearDashboardState removes runtime state file', () => {
  const homeDir = tempDir('construct-service-clear-');
  const runtimeDir = path.join(homeDir, '.construct', 'runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });
  const statePath = path.join(runtimeDir, 'dashboard.json');
  fs.writeFileSync(statePath, '{}\n');

  clearDashboardState(homeDir);
  assert.equal(fs.existsSync(statePath), false);
});

test('startServices starts Langfuse in the background and records the log path', async () => {
  const homeDir = tempDir('construct-service-langfuse-');
  const rootDir = tempDir('construct-service-root-');
  fs.mkdirSync(path.join(rootDir, 'langfuse'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'langfuse', 'docker-compose.yml'), 'services: {}\n');
  const calls = [];

  const spawnDetachedFn = (command, args, _homeDir, logFile, options) => {
    calls.push({ command, args, options });
    return {
      child: { pid: 43210, unref() {} },
      logPath: path.join(homeDir, '.construct', 'runtime', logFile),
    };
  };
  const { results } = await startServices({
    rootDir,
    homeDir,
    describeRuntimeSupportFn: async () => ({ docker: true, cm: false, opencode: false, tmux: false }),
    getRuntimePortsFn: async () => ({ dashboard: 4242, memory: 8765, bridge: 5173 }),
    startDashboardFn: async () => ({ url: 'http://127.0.0.1:4242', reused: true }),
    detectDockerComposeFn: () => ({ command: 'docker', argsPrefix: ['compose'] }),
    loadConstructEnvFn: () => ({}),
    spawnDetachedFn,
    verifyLangfuseKeysFn: async () => ({ status: 'verified' }),
  });
  const langfuse = results.find((entry) => entry.name === 'Langfuse');
  assert.ok(langfuse);
  assert.equal(langfuse.status, 'started');
  assert.match(langfuse.note, /startup complete/);
  assert.match(langfuse.note, /langfuse\.log/);

  const dockerCall = calls.find((entry) => entry.command === 'docker' && entry.args[0] === 'compose');
  assert.ok(dockerCall);
  assert.deepEqual(dockerCall.args, ['compose', '-p', 'construct-langfuse', '-f', path.join(rootDir, 'langfuse', 'docker-compose.yml'), 'up', '-d']);
  assert.equal(dockerCall.options, undefined);
});

test('getRuntimePorts reuses configured memory port when MCP endpoint is already live', async () => {
  const homeDir = tempDir('construct-service-ports-');
  const memoryPort = 9123;
  writeEnvValues(path.join(homeDir, '.construct', 'config.env'), { MEMORY_PORT: String(memoryPort) });

  const ports = await getRuntimePorts(homeDir, {
    dashboardProbeFn: async () => false,
    memoryProbeFn: async (port) => port === memoryPort,
    openCodeProbeFn: async () => false,
    findAvailablePortFn: async (startPort) => startPort + 1,
  });
  assert.equal(ports.memory, memoryPort);
});

test('startServices reuses an already-running memory service', async () => {
  const homeDir = tempDir('construct-service-memory-reuse-');
  const rootDir = tempDir('construct-service-memory-root-');
  const memoryPort = 8765;
  writeEnvValues(path.join(homeDir, '.construct', 'config.env'), { MEMORY_PORT: String(memoryPort) });

  const spawnCalls = [];
  const { results } = await startServices({
    rootDir,
    homeDir,
    describeRuntimeSupportFn: async () => ({ docker: false, cm: true, opencode: false, tmux: false }),
    getRuntimePortsFn: async () => ({ dashboard: 4242, memory: memoryPort, bridge: 5173 }),
    startDashboardFn: async () => ({ url: 'http://127.0.0.1:4242', reused: true }),
    detectDockerComposeFn: () => null,
    loadConstructEnvFn: () => ({}),
    spawnDetachedFn: (command, args) => {
      spawnCalls.push({ command, args });
      return {
        child: { pid: 12345, unref() {} },
        logPath: path.join(homeDir, '.construct', 'runtime', 'fake.log'),
      };
    },
    verifyLangfuseKeysFn: async () => ({ status: 'verified' }),
    memoryProbeFn: async (port) => port === memoryPort,
  });

  const memory = results.find((entry) => entry.name === 'Memory (cm)');
  assert.ok(memory);
  assert.equal(memory.status, 'reused');
  assert.equal(spawnCalls.some((entry) => entry.command === 'cm'), false);
});

// ── pruneStashDir ─────────────────────────────────────────────────────────

test('pruneStashDir keeps only the N most recent stash pairs', () => {
  const dir = tempDir('construct-prune-');
  // Create 5 stash pairs (dump + manifest json)
  const timestamps = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'];
  for (const ts of timestamps) {
    fs.writeFileSync(path.join(dir, `traces-${ts}.dump`), 'fake-dump-data');
    fs.writeFileSync(path.join(dir, `traces-${ts}.json`), '{}');
  }

  _pruneStashDir(dir, 3);

  const remaining = fs.readdirSync(dir).sort();
  // Should keep the 3 most recent (sorted reverse = 05, 04, 03)
  assert.deepEqual(remaining, [
    'traces-2025-01-03.dump', 'traces-2025-01-03.json',
    'traces-2025-01-04.dump', 'traces-2025-01-04.json',
    'traces-2025-01-05.dump', 'traces-2025-01-05.json',
  ]);
});

test('pruneStashDir is a no-op when fewer than keep limit', () => {
  const dir = tempDir('construct-prune-few-');
  fs.writeFileSync(path.join(dir, 'traces-2025-01-01.dump'), 'data');
  fs.writeFileSync(path.join(dir, 'traces-2025-01-01.json'), '{}');

  _pruneStashDir(dir, 3);
  assert.equal(fs.readdirSync(dir).length, 2);
});

// ── verifyLangfuseKeys — simulated environment ────────────────────────────

test('verifyLangfuseKeys returns verified when keys work on first try', async () => {
  const homeDir = tempDir('construct-verify-ok-');
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    if (url.includes('/traces')) return { ok: true };
    return { ok: false };
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'verified');
});

test('verifyLangfuseKeys returns unreachable when fetch throws', async () => {
  const homeDir = tempDir('construct-verify-unreach-');
  let callCount = 0;
  const fetchFn = async (url) => {
    callCount++;
    if (url.includes('/health')) return { ok: true };
    throw new Error('connection refused');
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'unreachable');
});

test('verifyLangfuseKeys returns auth-failed without compose runner', async () => {
  const homeDir = tempDir('construct-verify-nocompose-');
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    return { ok: false, status: 401 };
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
    // composeRunner and composeFile intentionally omitted
  });
  assert.equal(result.status, 'auth-failed');
  assert.equal(result.reseeded, false);
});

test('verifyLangfuseKeys performs full stash/reseed/rehydrate cycle', async () => {
  const homeDir = tempDir('construct-verify-reseed-');
  const composeRunner = { command: 'docker', argsPrefix: ['compose'] };
  const composeFile = '/fake/docker-compose.yml';
  const spawnCalls = [];

  // Simulate pg_dump returning 256 bytes of fake trace data
  const fakeTraceData = Buffer.alloc(256, 'T');
  const spawnSyncFn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args: [...args], opts });
    // pg_dump call — return fake data
    if (cmd === 'docker' && args.includes('pg_dump')) {
      return { status: 0, stdout: fakeTraceData };
    }
    // pg_restore call — return success
    if (cmd === 'docker' && args.includes('pg_restore')) {
      return { status: 0 };
    }
    // All other calls (compose down/up, docker cp) — success
    return { status: 0 };
  };

  let authAttempt = 0;
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    if (url.includes('/traces')) {
      authAttempt++;
      // First auth check fails (401), subsequent ones succeed (post-reseed)
      return { ok: authAttempt > 1 };
    }
    return { ok: false };
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    composeRunner,
    composeFile,
    maxRetries: 2,
    intervalMs: 0,
    spawnSyncFn,
    fetchFn,
  });

  // ── Verify result ──
  assert.equal(result.status, 'reseeded');
  assert.equal(result.dataPreserved, true);
  assert.ok(result.stashPath);
  assert.ok(result.stashPath.includes('.construct/backups/langfuse/traces-'));

  // ── Verify stash files on disk ──
  const stashDir = path.join(homeDir, '.construct', 'backups', 'langfuse');
  const stashFiles = fs.readdirSync(stashDir);
  const dumps = stashFiles.filter((f) => f.endsWith('.dump'));
  const manifests = stashFiles.filter((f) => f.endsWith('.json'));
  assert.equal(dumps.length, 1);
  assert.equal(manifests.length, 1);

  // Verify dump content matches what pg_dump returned
  const savedDump = fs.readFileSync(path.join(stashDir, dumps[0]));
  assert.deepEqual(savedDump, fakeTraceData);

  // Verify manifest metadata
  const manifest = JSON.parse(fs.readFileSync(path.join(stashDir, manifests[0]), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.reason, 'langfuse-key-reseed');
  assert.equal(manifest.dumpBytes, 256);
  assert.ok(Array.isArray(manifest.excludedTables));
  assert.ok(manifest.excludedTables.includes('api_keys'));
  assert.ok(manifest.excludedTables.includes('users'));

  // ── Verify Docker command sequence ──
  const cmdSummary = spawnCalls.map((c) => {
    if (c.cmd === 'docker' && c.args.includes('pg_dump')) return 'pg_dump';
    if (c.cmd === 'docker' && c.args.includes('down')) return 'compose-down';
    if (c.cmd === 'docker' && c.args.includes('up')) return 'compose-up';
    if (c.cmd === 'docker' && c.args.includes('cp')) return 'docker-cp';
    if (c.cmd === 'docker' && c.args.includes('pg_restore')) return 'pg_restore';
    return `${c.cmd} ${c.args[0]}`;
  });
  assert.deepEqual(cmdSummary, ['pg_dump', 'compose-down', 'compose-up', 'docker-cp', 'pg_restore']);

  // Verify pg_dump excluded auth tables
  const pgDumpCall = spawnCalls[0];
  assert.ok(pgDumpCall.args.includes('--exclude-table-data'));
  assert.ok(pgDumpCall.args.includes('api_keys'));
  assert.ok(pgDumpCall.args.includes('_prisma_migrations'));

  // Verify compose down used -v to remove volumes
  const downCall = spawnCalls[1];
  assert.ok(downCall.args.includes('-v'));
  assert.ok(downCall.args.includes('-p'));
  assert.ok(downCall.args.includes('construct-langfuse'));

  // Verify pg_restore used safety flags
  const restoreCall = spawnCalls[4];
  assert.ok(restoreCall.args.includes('--disable-triggers'));
  assert.ok(restoreCall.args.includes('--no-owner'));
  assert.ok(restoreCall.args.includes('--data-only'));
});

test('verifyLangfuseKeys handles empty database (no trace data to stash)', async () => {
  const homeDir = tempDir('construct-verify-empty-');
  const composeRunner = { command: 'docker', argsPrefix: ['compose'] };
  const composeFile = '/fake/docker-compose.yml';

  // pg_dump returns minimal output (< 100 bytes) — no meaningful data
  const spawnSyncFn = (cmd, args) => {
    if (cmd === 'docker' && args.includes('pg_dump')) {
      return { status: 0, stdout: Buffer.from('empty') };
    }
    return { status: 0 };
  };

  let authAttempt = 0;
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    if (url.includes('/traces')) {
      authAttempt++;
      return { ok: authAttempt > 1 };
    }
    return { ok: false };
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    composeRunner,
    composeFile,
    maxRetries: 2,
    intervalMs: 0,
    spawnSyncFn,
    fetchFn,
  });

  assert.equal(result.status, 'reseeded');
  assert.equal(result.dataPreserved, false);

  // No stash files should be written for empty data
  const stashDir = path.join(homeDir, '.construct', 'backups', 'langfuse');
  const stashFiles = fs.readdirSync(stashDir);
  assert.equal(stashFiles.filter((f) => f.endsWith('.dump')).length, 0);
});

test('verifyLangfuseKeys returns auth-failed when reseed container never becomes healthy', async () => {
  const homeDir = tempDir('construct-verify-unhealthy-');
  const composeRunner = { command: 'docker', argsPrefix: ['compose'] };
  const composeFile = '/fake/docker-compose.yml';

  const spawnSyncFn = () => ({ status: 0, stdout: Buffer.alloc(256, 'T') });

  // fetch always returns 401 — container never becomes healthy after reseed
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    return { ok: false, status: 401 };
  };

  const result = await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    composeRunner,
    composeFile,
    maxRetries: 2,
    intervalMs: 0,
    spawnSyncFn,
    fetchFn,
  });

  assert.equal(result.status, 'auth-failed');
  assert.equal(result.reseeded, true);
});

test('verifyLangfuseKeys prunes old stashes during reseed', async () => {
  const homeDir = tempDir('construct-verify-prune-');
  const stashDir = path.join(homeDir, '.construct', 'backups', 'langfuse');
  fs.mkdirSync(stashDir, { recursive: true });

  // Pre-seed 4 old stash pairs
  for (const ts of ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04']) {
    fs.writeFileSync(path.join(stashDir, `traces-${ts}.dump`), 'old-data');
    fs.writeFileSync(path.join(stashDir, `traces-${ts}.json`), '{}');
  }

  const composeRunner = { command: 'docker', argsPrefix: ['compose'] };
  const composeFile = '/fake/docker-compose.yml';
  const spawnSyncFn = (cmd, args) => {
    if (cmd === 'docker' && args.includes('pg_dump')) {
      return { status: 0, stdout: Buffer.alloc(256, 'X') };
    }
    return { status: 0 };
  };

  let authAttempt = 0;
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    if (url.includes('/traces')) {
      authAttempt++;
      return { ok: authAttempt > 1 };
    }
    return { ok: false };
  };

  await _verifyLangfuseKeys({
    baseUrl: 'http://fake:3000',
    homeDir,
    composeRunner,
    composeFile,
    maxRetries: 2,
    intervalMs: 0,
    spawnSyncFn,
    fetchFn,
  });

  // Should have 3 stash pairs total (pruned 2 old ones, kept 2 most recent old + 1 new)
  const dumps = fs.readdirSync(stashDir).filter((f) => f.endsWith('.dump')).sort();
  assert.equal(dumps.length, 3);
  // The 2 oldest (01, 02) should be pruned; 03, 04, and the new one remain
  assert.ok(dumps[0].startsWith('traces-2025-01-03'));
  assert.ok(dumps[1].startsWith('traces-2025-01-04'));
  // The 3rd is the newly created one (timestamp-based)
  assert.ok(!dumps[2].startsWith('traces-2025-01-01'));
  assert.ok(!dumps[2].startsWith('traces-2025-01-02'));
});
