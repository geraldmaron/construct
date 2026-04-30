/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the dashboard process, local Langfuse (Docker), memory server (cm),
 * and OpenCode. startServices() is the single entry point for `construct up`;
 * it spawns whatever is available and returns a result per service.
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

const CONSTRUCT_PG_COMPOSE_DIR = 'services/postgres';
const CONSTRUCT_PG_CONTAINER = 'construct-postgres';
const CONSTRUCT_PG_PORT = 54329;
const CONSTRUCT_PG_HEALTH_RETRIES = 12;
const CONSTRUCT_PG_HEALTH_INTERVAL_MS = 2000;

const DASHBOARD_STATE_FILE = 'dashboard.json';

const LANGFUSE_LOCAL_BASEURL = 'http://localhost:3000';
const LANGFUSE_LOCAL_PUBLIC_KEY = 'pk-lf-construct-local';
const LANGFUSE_LOCAL_SECRET_KEY = 'sk-lf-construct-local';
const LANGFUSE_VERIFY_MAX_RETRIES = 12;
const LANGFUSE_VERIFY_INTERVAL_MS = 5000;

/**
 * Keep only the N most recent stash pairs (.dump + .json) in the stash dir.
 */
function pruneStashDir(dir, keep = 3) {
  try {
    const dumps = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.dump'))
      .sort()
      .reverse();
    for (const dump of dumps.slice(keep)) {
      fs.rmSync(path.join(dir, dump), { force: true });
      fs.rmSync(path.join(dir, dump.replace('.dump', '.json')), { force: true });
    }
  } catch { /* non-critical */ }
}

/**
 * Verify Langfuse API keys work. If the container started from a stale volume
 * (before LANGFUSE_INIT_* vars were added), keys won't be seeded.
 * In that case, remove the DB volume and recreate the container to force re-seeding.
 */
async function verifyLangfuseKeys({
  baseUrl = LANGFUSE_LOCAL_BASEURL,
  publicKey = LANGFUSE_LOCAL_PUBLIC_KEY,
  secretKey = LANGFUSE_LOCAL_SECRET_KEY,
  composeRunner,
  composeFile,
  homeDir = os.homedir(),
  maxRetries = LANGFUSE_VERIFY_MAX_RETRIES,
  intervalMs = LANGFUSE_VERIFY_INTERVAL_MS,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
  overallTimeoutMs = 0, // 0 means no overall timeout
} = {}) {
  async function doVerify() {
    const auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;

    // Wait for Langfuse to be healthy before verifying keys
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetchFn(`${baseUrl}/api/public/health`, { signal: controller.signal }).finally(() => clearTimeout(timer));
        if (res.ok) break;
      } catch { /* not ready yet */ }
      if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetchFn(`${baseUrl}/api/public/traces?limit=1`, {
        headers: { Authorization: auth },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) return { status: 'verified' };
    } catch {
      return { status: 'unreachable' };
    }

    // Keys rejected — stale volume from before LANGFUSE_INIT_* vars were added.
    // Langfuse uses its own internal hashing for API keys (not plain SHA256),
    // so we cannot seed keys via SQL. Strategy: stash trace data to durable
    // storage, recreate the volume so LANGFUSE_INIT_* runs on fresh migration,
    // then rehydrate from the stash.
    if (!composeRunner || !composeFile) return { status: 'auth-failed', reseeded: false };

    // ── Durable stash location ──────────────────────────────────────────
    // ~/.construct/backups/langfuse/ — survives reboots, sits alongside
    // other Construct state, and is easy to find for manual recovery.
    const stashDir = path.join(homeDir, '.construct', 'backups', 'langfuse');
    fs.mkdirSync(stashDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpFile = path.join(stashDir, `traces-${timestamp}.dump`);
    const manifestFile = path.join(stashDir, `traces-${timestamp}.json`);

    // Tables seeded by LANGFUSE_INIT_* — exclude from dump so they don't
    // conflict with the fresh init. Everything else is trace data we keep.
    const authTables = [
      'organizations', 'org_memberships', 'projects', 'project_memberships',
      'api_keys', 'users', 'accounts', 'sessions', '_prisma_migrations',
    ];
    const excludeArgs = authTables.flatMap((t) => ['--exclude-table-data', t]);

    const dump = spawnSyncFn('docker', [
      'exec', 'construct-langfuse-db',
      'pg_dump', '-U', 'langfuse', '-d', 'langfuse',
      '-Fc',
      '--data-only',
      ...excludeArgs,
    ], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 200 * 1024 * 1024 });

    const hasData = dump.status === 0 && dump.stdout?.length > 100;
    if (hasData) {
      fs.writeFileSync(dumpFile, dump.stdout);
      fs.writeFileSync(manifestFile, JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        reason: 'langfuse-key-reseed',
        dumpFile: path.basename(dumpFile),
        dumpBytes: dump.stdout.length,
        excludedTables: authTables,
        langfuseVersion: '3',
      }, null, 2) + '\n');
    }

    const args = [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile];
    spawnSyncFn(composeRunner.command, [...args, 'down', '-v'], { stdio: 'ignore' });
    spawnSyncFn(composeRunner.command, [...args, 'up', '-d'], { stdio: 'ignore' });

    let healthy = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetchFn(`${baseUrl}/api/public/traces?limit=1`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (res.ok) { healthy = true; break; }
      } catch { /* still starting */ }
    }

    if (healthy && hasData) {
      spawnSyncFn('docker', [
        'cp', dumpFile, 'construct-langfuse-db:/tmp/traces.dump',
      ], { stdio: 'ignore' });
      const restore = spawnSyncFn('docker', [
        'exec', 'construct-langfuse-db',
        'pg_restore', '-U', 'langfuse', '-d', 'langfuse',
        '--data-only', '--disable-triggers', '--no-owner',
        '/tmp/traces.dump',
      ], { stdio: 'ignore' });

      pruneStashDir(stashDir, 3);
      return { status: 'reseeded', dataPreserved: restore.status === 0, stashPath: dumpFile };
    }

    if (healthy) return { status: 'reseeded', dataPreserved: false };

    return { status: 'auth-failed', reseeded: true };
  }

  if (overallTimeoutMs > 0) {
    return Promise.race([
      doVerify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('verifyLangfuseKeys timeout')), overallTimeoutMs))
    ]);
  }

  return doVerify();
}

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
} = {}) {
  const support = await describeRuntimeSupportFn();
  const ports = await getRuntimePortsFn(homeDir);
  const envPath = getUserEnvPath(homeDir);

  writeEnvValues(envPath, {
    DASHBOARD_PORT: String(ports.dashboard),
    MEMORY_PORT: String(ports.memory),
    BRIDGE_PORT: String(ports.bridge),
  });

  const results = [];

  // Construct Postgres — start if DATABASE_URL points to managed container
  const liveEnv = loadConstructEnvFn({ rootDir, homeDir });
  const databaseUrl = liveEnv.DATABASE_URL || '';
  const usesManagedPostgres = databaseUrl.includes('54329') || databaseUrl.includes('construct');

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

  // Langfuse — start local Docker unless a remote URL is explicitly configured
  const langfuseUrl = liveEnv.LANGFUSE_BASEURL ?? '';
  const isRemoteLangfuse = langfuseUrl && !langfuseUrl.includes('localhost') && !langfuseUrl.includes('127.0.0.1');

  if (isRemoteLangfuse) {
    results.push({ name: 'Langfuse', url: langfuseUrl, status: 'configured' });
  } else {
    const composeRunner = detectDockerComposeFn();
    if (composeRunner) {
      const composeFile = path.join(rootDir, 'langfuse', 'docker-compose.yml');
      const { logPath } = spawnDetachedFn(
        composeRunner.command,
        [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile, 'up', '-d'],
        homeDir,
        'langfuse.log',
      );
      writeEnvValues(envPath, {
        LANGFUSE_BASEURL: LANGFUSE_LOCAL_BASEURL,
        LANGFUSE_PUBLIC_KEY: LANGFUSE_LOCAL_PUBLIC_KEY,
        LANGFUSE_SECRET_KEY: LANGFUSE_LOCAL_SECRET_KEY,
      });

       // Verify keys work — reseed from stale volume if needed
       const verify = await verifyLangfuseKeysFn({ composeRunner, composeFile, maxRetries: 3, intervalMs: 2000, overallTimeoutMs: 30000 });
      const note = verify.status === 'reseeded'
        ? 'keys reseeded — stale volume was recreated'
        : verify.status === 'auth-failed'
          ? `keys rejected — manual reset needed; logs: ${logPath}`
          : `startup complete; logs: ${logPath}`;

      results.push({
        name: 'Langfuse',
        url: LANGFUSE_LOCAL_BASEURL,
        status: verify.status === 'auth-failed' ? 'degraded' : 'started',
        note,
      });
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

  return { support, ports, results };
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
