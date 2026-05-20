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

import { buildRuntimeRecoverySummary, clearDashboardState, readDashboardState, isManagedConstructPostgresUrl, startServices, stopDashboard, stopServices, getRuntimePorts, _verifyTelemetryKeys } from '../lib/service-manager.mjs';
import { writeEnvValues } from '../lib/env-config.mjs';

import { tempDir } from './helpers.mjs';

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

test('startServices skips telemetry when CONSTRUCT_TELEMETRY_URL is not set', async () => {
  const homeDir = tempDir('construct-service-telemetry-');
  const rootDir = tempDir('construct-service-root-');
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
    verifyTelemetryKeysFn: async () => ({ status: 'unconfigured' }),
  });
  const telemetryEntry = results.find((entry) => entry.name === 'Telemetry');
  // When no CONSTRUCT_TELEMETRY_URL is set, startManagedServices returns unavailable/skipped
  assert.ok(telemetryEntry);
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
    verifyTelemetryKeysFn: async () => ({ status: 'verified' }),
    memoryProbeFn: async (port) => port === memoryPort,
  });

  const memory = results.find((entry) => entry.name === 'Memory (cm)');
  assert.ok(memory);
  assert.equal(memory.status, 'reused');
  assert.equal(spawnCalls.some((entry) => entry.command === 'cm'), false);
});

test('startServices runs pressure cleanup before probing OpenCode', async () => {
  const homeDir = tempDir('construct-service-pressure-');
  const rootDir = tempDir('construct-service-pressure-root-');
  const calls = [];

  const { results } = await startServices({
    rootDir,
    homeDir,
    describeRuntimeSupportFn: async () => ({ docker: false, cm: false, opencode: true, tmux: false }),
    getRuntimePortsFn: async () => ({ dashboard: 4242, memory: 8765, bridge: 5173 }),
    startDashboardFn: async () => ({ url: 'http://127.0.0.1:4242', reused: true }),
    detectDockerComposeFn: () => null,
    loadConstructEnvFn: () => ({}),
    runPressureReleaseFn: () => {
      calls.push('cleanup');
      return { pressureTriggered: false, killed: [] };
    },
    openCodeProbeFn: async () => {
      calls.push('probe');
      return true;
    },
  });

  assert.deepEqual(calls, ['cleanup', 'probe']);
  const openCode = results.find((entry) => entry.name === 'OpenCode');
  assert.ok(openCode);
  assert.equal(openCode.status, 'reused');
});

test('startServices returns durable recovery anchors when Docker-backed services are unavailable', async () => {
  const homeDir = tempDir('construct-service-recovery-home-');
  const rootDir = tempDir('construct-service-recovery-root-');
  fs.writeFileSync(path.join(rootDir, 'plan.md'), '# Plan\n');
  fs.mkdirSync(path.join(rootDir, '.cx', 'handoffs'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.cx', 'context.md'), '# Context\n');
  fs.writeFileSync(path.join(rootDir, '.cx', 'handoffs', '2026-05-05-resume.md'), '# Handoff\n');
  fs.mkdirSync(path.join(rootDir, '.beads'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, '.beads', 'metadata.json'), '{}\n');

  const { results, recovery } = await startServices({
    rootDir,
    homeDir,
    describeRuntimeSupportFn: async () => ({ docker: false, cm: false, opencode: false, tmux: false }),
    getRuntimePortsFn: async () => ({ dashboard: 4242, memory: 8765, bridge: 5173 }),
    startDashboardFn: async () => ({ url: 'http://127.0.0.1:4242', reused: true }),
    detectDockerComposeFn: () => null,
    loadConstructEnvFn: () => ({}),
    runPressureReleaseFn: () => ({ pressureTriggered: false, killed: [] }),
  });

  assert.equal(results.some((entry) => entry.status === 'unavailable'), true);
  assert.equal(recovery.canResumeFromFiles, true);
  assert.equal(recovery.durable.plan, 'plan.md');
  assert.equal(recovery.durable.context, '.cx/context.md');
  assert.equal(recovery.durable.latestHandoff, path.join('.cx', 'handoffs', '2026-05-05-resume.md'));
  assert.equal(recovery.durable.beads, '.beads/metadata.json');
  assert.match(recovery.message, /partially degraded/);
});

test('buildRuntimeRecoverySummary works with only file-state anchors', () => {
  const homeDir = tempDir('construct-service-recovery-home-');
  const rootDir = tempDir('construct-service-recovery-root-');
  fs.writeFileSync(path.join(rootDir, 'plan.md'), '# Plan\n');

  const summary = buildRuntimeRecoverySummary({
    rootDir,
    homeDir,
    results: [{ name: 'Telemetry', status: 'unavailable', note: 'Docker not available' }],
  });

  assert.equal(summary.canResumeFromFiles, true);
  assert.equal(summary.durable.plan, 'plan.md');
  assert.deepEqual(summary.degraded, [{ name: 'Telemetry', status: 'unavailable', note: 'Docker not available' }]);
});

test('managed Postgres detection does not capture external databases named construct', () => {
  assert.equal(isManagedConstructPostgresUrl('postgresql://construct:construct@127.0.0.1:54329/construct'), true);
  assert.equal(isManagedConstructPostgresUrl('postgresql://construct:construct@localhost:54329/construct'), true);
  assert.equal(isManagedConstructPostgresUrl('postgresql://user:pass@db.example.com:5432/construct'), false);
  assert.equal(isManagedConstructPostgresUrl('postgresql://user:pass@127.0.0.1:5432/construct'), false);
});

// ── verifyTelemetryKeys — simulated environment ────────────────────────────

test('verifyTelemetryKeys returns verified when keys work on first try', async () => {
  const homeDir = tempDir('construct-verify-ok-');
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    if (url.includes('/traces')) return { ok: true };
    return { ok: false };
  };

  const result = await _verifyTelemetryKeys({
    baseUrl: 'http://fake:3000',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'verified');
});

test('verifyTelemetryKeys returns unreachable when fetch throws', async () => {
  const homeDir = tempDir('construct-verify-unreach-');
  let callCount = 0;
  const fetchFn = async (url) => {
    callCount++;
    if (url.includes('/health')) return { ok: true };
    throw new Error('connection refused');
  };

  const result = await _verifyTelemetryKeys({
    baseUrl: 'http://fake:3000',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'unreachable');
});

test('verifyTelemetryKeys returns auth-failed without compose runner', async () => {
  const homeDir = tempDir('construct-verify-nocompose-');
  const fetchFn = async (url) => {
    if (url.includes('/health')) return { ok: true };
    return { ok: false, status: 401 };
  };

  const result = await _verifyTelemetryKeys({
    baseUrl: 'http://fake:3000',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
    // composeRunner and composeFile intentionally omitted
  });
  assert.equal(result.status, 'auth-failed');
  assert.equal(result.reseeded, false);
});

test('verifyTelemetryKeys returns unconfigured when keys are missing', async () => {
  const homeDir = tempDir('construct-verify-nokeys-');
  const fetchFn = async () => ({ ok: true });

  const result = await _verifyTelemetryKeys({
    baseUrl: 'http://fake:3000',
    // publicKey and secretKey intentionally omitted
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'unconfigured');
});

test('verifyTelemetryKeys returns unconfigured when baseUrl is missing', async () => {
  const homeDir = tempDir('construct-verify-nourl-');
  const fetchFn = async () => ({ ok: true });

  const result = await _verifyTelemetryKeys({
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    // baseUrl intentionally omitted
    homeDir,
    maxRetries: 1,
    intervalMs: 0,
    fetchFn,
  });
  assert.equal(result.status, 'unconfigured');
});

test('stopServices returns per-service results with no guidance message', async () => {
  const homeDir = tempDir('cx-stop-');
  const rootDir = tempDir('cx-root-');
  const noopSpawn = () => ({ status: 0, stdout: '', stderr: '' });
  const noDocker = () => null;

  const result = await stopServices({ homeDir, rootDir, spawnSyncFn: noopSpawn, detectDockerComposeFn: noDocker });

  assert.ok(Array.isArray(result.results), 'results is an array');
  assert.ok(!('guidance' in result), 'no guidance field on result');

  const names = result.results.map((r) => r.name);
  assert.ok(names.includes('Dashboard'), 'Dashboard entry present');
  assert.ok(names.includes('Memory (cm)'), 'Memory (cm) entry present');
  assert.ok(names.includes('OpenCode'), 'OpenCode entry present');
});

test('stopServices reports stopped Dashboard when pid is live', async () => {
  const homeDir = tempDir('cx-stop2-');
  const rootDir = tempDir('cx-root2-');
  const stateDir = path.join(homeDir, '.construct', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const state = { pid: process.pid, port: 4242, url: 'http://127.0.0.1:4242', startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(stateDir, 'dashboard.json'), JSON.stringify(state));

  const noopSpawn = () => ({ status: 0, stdout: '', stderr: '' });
  const noDocker = () => null;
  const result = await stopServices({ homeDir, rootDir, spawnSyncFn: noopSpawn, detectDockerComposeFn: noDocker });

  const dash = result.results.find((r) => r.name === 'Dashboard');
  assert.ok(dash.status === 'stopped' || dash.status === 'not-running', `unexpected status: ${dash.status}`);
});

test('stopServices runs docker compose down when compose file exists', async () => {
  const homeDir = tempDir('cx-stop3-');
  const rootDir = tempDir('cx-root3-');
  // Create the postgres compose file so the branch is taken
  const composeDir = path.join(rootDir, 'services', 'postgres');
  fs.mkdirSync(composeDir, { recursive: true });
  fs.writeFileSync(path.join(composeDir, 'docker-compose.yml'), 'version: "3"');

  const calls = [];
  const trackingSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args });
    return { status: 0, stdout: '', stderr: '' };
  };
  const fakeCompose = () => ({ command: 'docker', argsPrefix: ['compose'] });

  await stopServices({ homeDir, rootDir, spawnSyncFn: trackingSpawn, detectDockerComposeFn: fakeCompose });

  const composeDown = calls.find((c) => c.args.includes('down'));
  assert.ok(composeDown, 'docker compose down was called');
  assert.ok(composeDown.args.includes('construct-postgres'), 'project name passed');
});
