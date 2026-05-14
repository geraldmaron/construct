/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the dashboard process, local Langfuse (Docker), memory server (cm),
 * and OpenCode. startServices() is the single entry point for `construct up` —
 * spawns whatever is available and returns a result per service.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { findAvailablePort } from './host-capabilities.mjs';
import { getUserEnvPath, loadConstructEnv, parseEnvFile, writeEnvValues } from './env-config.mjs';
import { detectDockerCompose } from './setup.mjs';
import { stashConstructDb, restoreConstructDb } from './storage/postgres-backup.mjs';
import { runPressureRelease } from './runtime-pressure.mjs';
import {
  pruneStashDir,
  verifyLangfuseKeys,
  isRemoteLangfuse as isRemoteLangfuseUrl,
  startManagedLangfuse,
} from './services/langfuse.mjs';

const CONSTRUCT_PG_COMPOSE_DIR = 'services/postgres';
const CONSTRUCT_PG_CONTAINER = 'construct-postgres';
const CONSTRUCT_PG_PORT = 54329;
const CONSTRUCT_PG_HEALTH_RETRIES = 12;
const CONSTRUCT_PG_HEALTH_INTERVAL_MS = 2000;

const DASHBOARD_STATE_FILE = 'dashboard.json';

// Langfuse constants, pruneStashDir, and verifyLangfuseKeys now live in
// lib/services/langfuse.mjs so `construct setup` and `construct up` can share
// the same spin-up path. Re-exported below at module bottom for tests that
// already import _verifyLangfuseKeys and _pruneStashDir from here.


function runtimeStateDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.construct', 'runtime');
}

function dashboardStatePath(homeDir = os.homedir()) {
  return path.join(runtimeStateDir(homeDir), DASHBOARD_STATE_FILE);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function latestHandoffPath(rootDir) {
  const handoffsDir = path.join(rootDir, '.cx', 'handoffs');
  try {
    const entries = fs.readdirSync(handoffsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => {
        const fullPath = path.join(handoffsDir, entry.name);
        const stat = fs.statSync(fullPath);
        return { path: fullPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return entries[0]?.path || null;
  } catch {
    return null;
  }
}

function relativeOrNull(rootDir, filePath) {
  return filePath ? path.relative(rootDir, filePath) || path.basename(filePath) : null;
}

export function buildRuntimeRecoverySummary({ rootDir, homeDir = os.homedir(), results = [], env = process.env } = {}) {
  const unavailable = results
    .filter((service) => ['unavailable', 'degraded', 'error', 'failed'].includes(service.status))
    .map((service) => ({
      name: service.name,
      status: service.status,
      note: service.note || null,
    }));

  const durable = {
    plan: fs.existsSync(path.join(rootDir, 'plan.md')) ? 'plan.md' : null,
    context: fs.existsSync(path.join(rootDir, '.cx', 'context.md')) ? '.cx/context.md' : null,
    contextJson: fs.existsSync(path.join(rootDir, '.cx', 'context.json')) ? '.cx/context.json' : null,
    latestHandoff: relativeOrNull(rootDir, latestHandoffPath(rootDir)),
    beads: fs.existsSync(path.join(rootDir, '.beads', 'metadata.json')) ? '.beads/metadata.json' : null,
    userConfig: fs.existsSync(getUserEnvPath(homeDir)) ? getUserEnvPath(homeDir) : null,
    userDataRoot: env.CX_DATA_DIR || path.join(homeDir, '.cx'),
  };

  return {
    durable,
    degraded: unavailable,
    canResumeFromFiles: Boolean(durable.plan || durable.context || durable.latestHandoff || durable.beads),
    message: unavailable.length
      ? 'Runtime is partially degraded; resume from durable project files and restart services when dependencies return.'
      : 'Runtime services are available; durable project files remain the source of truth.',
  };
}

export function isManagedConstructPostgresUrl(databaseUrl = '') {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname;
    return (
      parsed.port === String(CONSTRUCT_PG_PORT) &&
      ['127.0.0.1', 'localhost', '::1'].includes(host)
    ) || host === CONSTRUCT_PG_CONTAINER;
  } catch {
    return databaseUrl.includes(`:${CONSTRUCT_PG_PORT}/`);
  }
}

function processExists(pid) {
  if (!pid || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function probeRuntimePort(port, { host = '127.0.0.1', timeoutMs = 750 } = {}) {
  if (!Number.isInteger(port) || port <= 0) return false;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

async function probeRuntimeHttp(url, {
  method = 'GET',
  headers = undefined,
  body = undefined,
  timeoutMs = 1000,
} = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function isDashboardRunning(port) {
  return probeRuntimeHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 1000 });
}

async function isMemoryRunning(port) {
  const mcpReady = await probeRuntimeHttp(`http://127.0.0.1:${port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    timeoutMs: 1000,
  });
  if (mcpReady) return true;
  return probeRuntimePort(port);
}

async function isOpenCodeRunning(port) {
  return probeRuntimeHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 1000 });
}

function spawnDetached(command, args, homeDir, logFile, options = {}) {
  const logPath = path.join(runtimeStateDir(homeDir), logFile);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', fd, fd],
    cwd: options.cwd,
    env: options.env,
  });
  child.unref();
  return { child, logPath };
}

export function readDashboardState(homeDir = os.homedir()) {
  const state = readJson(dashboardStatePath(homeDir));
  if (!state) return null;
  if (!processExists(state.pid)) return null;
  return state;
}

export function clearDashboardState(homeDir = os.homedir()) {
  const filePath = dashboardStatePath(homeDir);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

export function stopDashboard(homeDir = os.homedir()) {
  const state = readJson(dashboardStatePath(homeDir));
  if (!state?.pid) {
    clearDashboardState(homeDir);
    return { stopped: false, reason: 'not-running' };
  }

  if (!processExists(state.pid)) {
    clearDashboardState(homeDir);
    return { stopped: false, reason: 'stale-state' };
  }

  process.kill(Number(state.pid), 'SIGTERM');
  clearDashboardState(homeDir);
  return { stopped: true, pid: Number(state.pid), port: state.port };
}

function doctorStatePath(homeDir) {
  return path.join(homeDir, '.construct', 'doctor.json');
}

export function readDoctorState(homeDir = os.homedir()) {
  const state = readJson(doctorStatePath(homeDir));
  if (!state) return null;
  if (!processExists(state.pid)) return null;
  return state;
}

export function stopDoctor(homeDir = os.homedir()) {
  const state = readJson(doctorStatePath(homeDir));
  const file = doctorStatePath(homeDir);
  if (!state?.pid) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return { stopped: false, reason: 'not-running' };
  }
  if (!processExists(state.pid)) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return { stopped: false, reason: 'stale-state' };
  }
  try { process.kill(Number(state.pid), 'SIGTERM'); } catch { /* gone */ }
  return { stopped: true, pid: Number(state.pid) };
}

export function startDoctor({ rootDir, homeDir = os.homedir() } = {}) {
  if (process.env.CONSTRUCT_DOCTOR === 'off') {
    return { started: false, reason: 'disabled' };
  }
  const existing = readDoctorState(homeDir);
  if (existing) return { started: false, reused: true, pid: existing.pid };
  const indexPath = path.join(rootDir, 'lib', 'doctor', 'index.mjs');
  if (!fs.existsSync(indexPath)) return { started: false, reason: 'missing-binary' };
  const { logPath } = spawnDetached('node', [indexPath], homeDir, 'doctor.log', { cwd: rootDir, env: { ...process.env } });
  return { started: true, logPath };
}

export async function startDashboard({ rootDir, homeDir = os.homedir(), preferredPort = 4242 } = {}) {
  const existing = readDashboardState(homeDir);
  if (existing && await isDashboardRunning(existing.port)) {
    return { started: false, reused: true, pid: existing.pid, port: existing.port, url: existing.url };
  }

  if (existing) clearDashboardState(homeDir);

  const port = await findAvailablePort(preferredPort);
  const outPath = path.join(runtimeStateDir(homeDir), 'dashboard.log');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.openSync(outPath, 'a');
  const err = fs.openSync(outPath, 'a');
  const child = spawn(process.execPath, [path.join(rootDir, 'lib', 'server', 'index.mjs')], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  const state = {
    pid: child.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
    logPath: outPath,
  };
  writeJson(dashboardStatePath(homeDir), state);
  return { started: true, reused: false, ...state };
}

/**
 * Resolve runtime ports. Re-uses ports from config.env when the service is
 * already listening there (avoids port drift on repeated `construct up`).
 */
export async function getRuntimePorts(homeDir = os.homedir(), {
  dashboardProbeFn = isDashboardRunning,
  memoryProbeFn = isMemoryRunning,
  openCodeProbeFn = isOpenCodeRunning,
  findAvailablePortFn = findAvailablePort,
} = {}) {
  const dashboard = readDashboardState(homeDir);
  const existing = parseEnvFile(getUserEnvPath(homeDir));

  async function resolvePort(key, fallback, probe = async (port) => probeRuntimePort(port)) {
    const saved = Number(existing[key]);
    if (Number.isFinite(saved) && saved > 0) {
      if (await probe(saved)) return saved;
    }
    return findAvailablePortFn(saved || fallback);
  }

  return {
    dashboard: dashboard?.port ?? await resolvePort('DASHBOARD_PORT', 4242, dashboardProbeFn),
    memory: await resolvePort('MEMORY_PORT', 8765, memoryProbeFn),
    bridge: await resolvePort('BRIDGE_PORT', 5173, openCodeProbeFn),
  };
}

export async function describeRuntimeSupport() {
  function commandExists(command) {
    try {
      const checker = process.platform === 'win32' ? 'where' : 'which';
      return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
    } catch {
      return false;
    }
  }
  return {
    tmux: commandExists('tmux'),
    docker: commandExists('docker'),
    cm: commandExists('cm'),
    opencode: commandExists('opencode'),
  };
}

// ── Construct Postgres management ──────────────────────────────────────────

function constructPgComposePath(rootDir) {
  return path.join(rootDir, CONSTRUCT_PG_COMPOSE_DIR, 'docker-compose.yml');
}

function isConstructPostgresRunning(spawnSyncFn = spawnSync) {
  const result = spawnSyncFn('docker', ['inspect', '--format', '{{.State.Running}}', CONSTRUCT_PG_CONTAINER], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.stdout?.trim() === 'true';
}

function isConstructPostgresHealthy(spawnSyncFn = spawnSync) {
  const result = spawnSyncFn('docker', ['exec', CONSTRUCT_PG_CONTAINER, 'pg_isready', '-U', 'construct'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0;
}

async function waitForConstructPostgresHealthy({
  spawnSyncFn = spawnSync,
  maxRetries = CONSTRUCT_PG_HEALTH_RETRIES,
  intervalMs = CONSTRUCT_PG_HEALTH_INTERVAL_MS,
} = {}) {
  for (let i = 0; i < maxRetries; i++) {
    if (isConstructPostgresHealthy(spawnSyncFn)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function startConstructPostgres({ rootDir, homeDir = os.homedir(), spawnSyncFn = spawnSync, detectDockerComposeFn = detectDockerCompose } = {}) {
  const composeRunner = detectDockerComposeFn();
  if (!composeRunner) return { status: 'unavailable', note: 'Docker not available' };

  const composeFile = constructPgComposePath(rootDir);
  if (!fs.existsSync(composeFile)) return { status: 'unavailable', note: 'Postgres compose file not found — run construct setup first' };

  const args = [...composeRunner.argsPrefix, '-p', 'construct-postgres', '-f', composeFile, 'up', '-d'];
  const r = spawnSyncFn(composeRunner.command, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status === 0) return { status: 'started' };
  return { status: 'error', note: (r.stderr || '').trim().split('\n')[0] || 'compose up failed' };
}

function stopConstructPostgres({ rootDir, homeDir = os.homedir(), spawnSyncFn = spawnSync, detectDockerComposeFn = detectDockerCompose } = {}) {
  const composeRunner = detectDockerComposeFn();
  if (!composeRunner) return { status: 'skipped', note: 'Docker not available' };

  const composeFile = constructPgComposePath(rootDir);
  if (!fs.existsSync(composeFile)) return { status: 'skipped', note: 'no compose file' };

  const args = [...composeRunner.argsPrefix, '-p', 'construct-postgres', '-f', composeFile, 'down'];
  const r = spawnSyncFn(composeRunner.command, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status === 0) return { status: 'stopped' };
  return { status: 'error', note: (r.stderr || '').trim().split('\n')[0] || 'compose down failed' };
}

function checkPgvectorEnabled(spawnSyncFn = spawnSync) {
  const result = spawnSyncFn('docker', [
    'exec', CONSTRUCT_PG_CONTAINER, 'psql', '-U', 'construct', '-d', 'construct',
    '-tAc', "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')",
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result.stdout?.trim() === 't';
}

export async function startServices({
  rootDir,
  homeDir = os.homedir(),
  describeRuntimeSupportFn = describeRuntimeSupport,
  getRuntimePortsFn = getRuntimePorts,
  startDashboardFn = startDashboard,
  detectDockerComposeFn = detectDockerCompose,
  loadConstructEnvFn = loadConstructEnv,
  spawnDetachedFn = spawnDetached,
  verifyLangfuseKeysFn = verifyLangfuseKeys,
  memoryProbeFn = isMemoryRunning,
  openCodeProbeFn = isOpenCodeRunning,
  runPressureReleaseFn = runPressureRelease,
} = {}) {
  const support = await describeRuntimeSupportFn();
  const ports = await getRuntimePortsFn(homeDir);
  const envPath = getUserEnvPath(homeDir);

  writeEnvValues(envPath, {
    DASHBOARD_PORT: String(ports.dashboard),
    MEMORY_PORT: String(ports.memory),
    BRIDGE_PORT: String(ports.bridge),
  });

  // Construct Postgres — start if DATABASE_URL points to managed container
  const liveEnv = loadConstructEnvFn({ rootDir, homeDir });
  const results = [];
  const pressureReport = runPressureReleaseFn({ env: liveEnv });
  if (pressureReport?.killed?.length) {
    results.push({
      name: 'Pressure Guard',
      url: 'local://cleanup',
      status: pressureReport.pressureTriggered ? 'started' : 'reused',
      note: `terminated ${pressureReport.killed.length} stale process(es)`,
    });
  }
  const databaseUrl = liveEnv.DATABASE_URL || '';
  const usesManagedPostgres = isManagedConstructPostgresUrl(databaseUrl);

  if (usesManagedPostgres) {
    if (!isConstructPostgresRunning()) {
      const pgStart = startConstructPostgres({ rootDir, homeDir, spawnSyncFn: spawnSync, detectDockerComposeFn: detectDockerComposeFn });
      if (pgStart.status === 'started') {
        const healthy = await waitForConstructPostgresHealthy();
        if (healthy) {
          const pgvector = checkPgvectorEnabled();
          results.push({
            name: 'Postgres',
            url: `postgresql://127.0.0.1:${CONSTRUCT_PG_PORT}/construct`,
            status: pgvector ? 'started' : 'degraded',
            note: pgvector ? 'pgvector enabled' : 'pgvector not installed — semantic search unavailable',
          });
        } else {
          results.push({ name: 'Postgres', status: 'degraded', note: 'container started but health check timed out' });
        }
      } else {
        results.push({ name: 'Postgres', status: 'error', note: pgStart.note });
      }
    } else {
      const pgvector = checkPgvectorEnabled();
      results.push({
        name: 'Postgres',
        url: `postgresql://127.0.0.1:${CONSTRUCT_PG_PORT}/construct`,
        status: 'reused',
        note: pgvector ? 'pgvector enabled' : 'pgvector not installed',
      });
    }
  } else if (databaseUrl) {
    results.push({ name: 'Postgres', url: databaseUrl, status: 'configured', note: 'external database' });
  }

  // Dashboard
  const dashboard = await startDashboardFn({ rootDir, homeDir, preferredPort: ports.dashboard });
  results.push({
    name: 'Dashboard',
    url: dashboard.url,
    status: dashboard.reused ? 'reused' : 'started',
  });

  // Langfuse — delegated to lib/services/langfuse.mjs so `construct setup`
  // and `construct up` share the spin-up path. Remote URLs short-circuit
  // inside startManagedLangfuse and just return a `configured` result.

  if (isRemoteLangfuseUrl(liveEnv.LANGFUSE_BASEURL ?? '')) {
    results.push({ name: 'Langfuse', url: liveEnv.LANGFUSE_BASEURL, status: 'configured' });
  } else {
    const composeRunner = detectDockerComposeFn();
    if (composeRunner) {
      const lf = await startManagedLangfuse({
        rootDir,
        homeDir,
        env: liveEnv,
        composeRunner,
        spawnDetached: spawnDetachedFn,
        verifyKeysFn: verifyLangfuseKeysFn,
      });
      results.push({ name: 'Langfuse', url: lf.url, status: lf.status, note: lf.note });
    } else {
      results.push({ name: 'Langfuse', status: 'unavailable', note: 'Docker not available' });
    }
  }

  // Memory (cm)
  if (support.cm) {
    if (await memoryProbeFn(ports.memory)) {
      results.push({ name: 'Memory (cm)', url: `http://127.0.0.1:${ports.memory}`, status: 'reused' });
    } else {
      spawnDetachedFn('cm', ['serve', '--port', String(ports.memory)], homeDir, 'cm.log');
      results.push({ name: 'Memory (cm)', url: `http://127.0.0.1:${ports.memory}`, status: 'started' });
    }
  } else {
    results.push({ name: 'Memory (cm)', status: 'unavailable', note: 'cm not installed — run: construct setup or brew install dicklesworthstone/tap/cm' });
  }

  // OpenCode (optional)
  if (support.opencode) {
    if (await openCodeProbeFn(ports.bridge)) {
      results.push({ name: 'OpenCode', url: `http://127.0.0.1:${ports.bridge}`, status: 'reused' });
    } else {
      spawnDetachedFn('opencode', ['serve', '--port', String(ports.bridge)], homeDir, 'opencode.log');
      results.push({ name: 'OpenCode', url: `http://127.0.0.1:${ports.bridge}`, status: 'started' });
    }
  }

  const doctor = startDoctor({ rootDir, homeDir });
  if (doctor.started) {
    results.push({ name: 'Doctor', status: 'started', note: `L0 daemon · logs: ${doctor.logPath}` });
  } else if (doctor.reused) {
    results.push({ name: 'Doctor', status: 'reused', note: `pid ${doctor.pid}` });
  } else if (doctor.reason !== 'disabled') {
    results.push({ name: 'Doctor', status: 'unavailable', note: doctor.reason });
  }

  emitServiceFailures(results);

  return {
    support,
    ports,
    results,
    recovery: buildRuntimeRecoverySummary({ rootDir, homeDir, results, env: liveEnv }),
  };
}

// Surface service probe failures into the role-framework event bus so cx-sre
// can be invoked when a critical service is down. Non-blocking, best effort.

async function emitServiceFailures(results) {
  if (process.env.CONSTRUCT_ROLES === 'off') return;
  const failed = results.filter((r) => r.status === 'error');
  if (failed.length === 0) return;
  try {
    const { emitRoleEvent } = await import('./roles/hook-emit.mjs');
    for (const r of failed) {
      emitRoleEvent({
        type: 'service.down',
        summary: `${r.name} ${r.status}: ${r.note || 'no detail'}`,
        hookInput: {},
        context: { service: r.name, note: r.note, url: r.url },
      });
    }
  } catch { /* best effort */ }
}

// Exported for testing only
export { verifyLangfuseKeys as _verifyLangfuseKeys, pruneStashDir as _pruneStashDir };

/**
 * Kill every process listening on a given TCP port (best-effort, non-fatal).
 * Returns true if at least one PID was killed.
 */
function killPortOwners(port, spawnSyncFn = spawnSync) {
  if (!port || !Number.isInteger(port) || port <= 0) return false;
  try {
    // lsof works on macOS and Linux; -t returns just PIDs
    const result = spawnSyncFn('lsof', ['-t', `-i:${port}`], { encoding: 'utf8' });
    const pids = (result.stdout || '').trim().split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0);
    if (pids.length === 0) return false;
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopServices({
  homeDir = os.homedir(),
  rootDir,
  spawnSyncFn = spawnSync,
  detectDockerComposeFn = detectDockerCompose,
} = {}) {
  const results = [];

  // Stash construct Postgres data before any container is stopped so data
  // survives Docker restarts and machine reboots.
  const constructDbStash = stashConstructDb({ homeDir, spawnSyncFn });

  // Construct Postgres
  const pgStop = stopConstructPostgres({ rootDir, homeDir, spawnSyncFn, detectDockerComposeFn });
  results.push({ name: 'Postgres', status: pgStop.status });

  // Doctor (L0 daemon)
  const doctor = stopDoctor(homeDir);
  if (doctor.stopped) {
    results.push({ name: 'Doctor', status: 'stopped', note: `pid ${doctor.pid}` });
  } else if (doctor.reason === 'stale-state') {
    results.push({ name: 'Doctor', status: 'cleaned', note: 'stale state file removed' });
  }

  // Dashboard
  const dashboard = stopDashboard(homeDir);
  if (dashboard.stopped) {
    results.push({ name: 'Dashboard', status: 'stopped', note: `pid ${dashboard.pid}, port ${dashboard.port}` });
  } else if (dashboard.reason === 'stale-state') {
    results.push({ name: 'Dashboard', status: 'cleaned', note: 'stale state file removed (process already gone)' });
  } else {
    results.push({ name: 'Dashboard', status: 'not-running' });
  }

  // Langfuse (Docker Compose)
  const composeRunner = detectDockerComposeFn();
  const composeFile = rootDir ? path.join(rootDir, 'langfuse', 'docker-compose.yml') : null;
  if (composeRunner && composeFile && fs.existsSync(composeFile)) {
    const args = [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile, 'down'];
    const r = spawnSyncFn(composeRunner.command, args, { stdio: 'pipe', encoding: 'utf8' });
    if (r.status === 0) {
      results.push({ name: 'Langfuse', status: 'stopped' });
    } else {
      results.push({ name: 'Langfuse', status: 'error', note: (r.stderr || '').trim().split('\n')[0] || 'compose down failed' });
    }
  } else if (!composeRunner) {
    results.push({ name: 'Langfuse', status: 'skipped', note: 'Docker not available' });
  } else {
    results.push({ name: 'Langfuse', status: 'skipped', note: 'no compose file found' });
  }

  // Memory (cm) — find port from config.env or fall back to default
  const envPath = getUserEnvPath(homeDir);
  const envValues = parseEnvFile(envPath);
  const memoryPort = Number(envValues.MEMORY_PORT) || 8765;
  const cmKilled = killPortOwners(memoryPort, spawnSyncFn);
  results.push({ name: 'Memory (cm)', status: cmKilled ? 'stopped' : 'not-running' });

  // OpenCode — find port from config.env or fall back to default
  const bridgePort = Number(envValues.BRIDGE_PORT) || 5173;
  const openCodeKilled = killPortOwners(bridgePort, spawnSyncFn);
  results.push({ name: 'OpenCode', status: openCodeKilled ? 'stopped' : 'not-running' });

  const stopped = results.filter((r) => r.status === 'stopped' || r.status === 'cleaned').map((r) => r.name);
  return { stopped, results, constructDbStash };
}
