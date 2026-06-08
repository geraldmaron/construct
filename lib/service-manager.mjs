/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the dashboard process, memory server (cm), and OpenCode. 
 * startServices() is the single entry point for `construct up` —
 * spawns whatever is available and returns a result per service.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAvailablePort } from './host-capabilities.mjs';
import { getUserEnvPath, loadConstructEnv, parseEnvFile, writeEnvValues } from './env-config.mjs';
import { runPressureRelease } from './runtime-pressure.mjs';
import { resolveTraceBackend, telemetryProviderLabel } from './telemetry/client.mjs';
import { memoryPort as derivedMemoryPort } from './home-namespace.mjs';

const DASHBOARD_STATE_FILE = 'dashboard.json';

const INSTALL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  // Construct no longer manages local Postgres containers.
  return false;
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
  const indexPath = path.join(INSTALL_ROOT, 'lib', 'doctor', 'index.mjs');
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
  const child = spawn(process.execPath, [path.join(INSTALL_ROOT, 'lib', 'server', 'index.mjs')], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  let ready = false;
  for (let i = 0; i < 30; i += 1) {
    if (await probeRuntimePort(port)) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!ready) {
    let logTail = '';
    try { logTail = fs.readFileSync(outPath, 'utf8').split('\n').slice(-12).join('\n'); } catch { /* log unreadable */ }
    return { started: false, failed: true, port, logPath: outPath, error: `dashboard did not bind 127.0.0.1:${port} within 6s`, logTail };
  }

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
    memory: await resolvePort('MEMORY_PORT', derivedMemoryPort(), memoryProbeFn),
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
    cm: commandExists('cm'),
    opencode: commandExists('opencode'),
  };
}

export const SELECTABLE_SERVICES = Object.freeze([
  { key: 'dashboard', label: 'Dashboard', description: 'Local operations dashboard on http://127.0.0.1:4242.' },
  { key: 'telemetry', label: 'Telemetry', description: 'Trace export / local JSONL traces.' },
  { key: 'memory', label: 'Memory (cm)', description: 'Persistent memory service (cm).' },
  { key: 'opencode', label: 'OpenCode', description: 'OpenCode bridge server.' },
]);

export async function startServices({
  rootDir,
  homeDir = os.homedir(),
  selected = null,
  describeRuntimeSupportFn = describeRuntimeSupport,
  getRuntimePortsFn = getRuntimePorts,
  startDashboardFn = startDashboard,
  loadConstructEnvFn = loadConstructEnv,
  spawnDetachedFn = spawnDetached,
  memoryProbeFn = isMemoryRunning,
  openCodeProbeFn = isOpenCodeRunning,
  runPressureReleaseFn = runPressureRelease,
} = {}) {
  const support = await describeRuntimeSupportFn();
  const ports = await getRuntimePortsFn(homeDir);
  const envPath = getUserEnvPath(homeDir);

  const wants = (key) => selected === null || selected.has(key);

  writeEnvValues(envPath, {
    DASHBOARD_PORT: String(ports.dashboard),
    MEMORY_PORT: String(ports.memory),
    BRIDGE_PORT: String(ports.bridge),
  });

  const liveEnv = loadConstructEnvFn({ rootDir, homeDir });
  const results = [];
  const pressureReport = runPressureReleaseFn({ env: { ...liveEnv, HOME: homeDir } });
  if (pressureReport?.killed?.length) {
    results.push({
      name: 'Pressure Guard',
      url: 'local://cleanup',
      status: pressureReport.pressureTriggered ? 'started' : 'reused',
      note: `terminated ${pressureReport.killed.length} stale process(es)`,
    });
  }

  // Dashboard
  if (wants('dashboard')) {
    const dashboard = await startDashboardFn({ rootDir, homeDir, preferredPort: ports.dashboard });
    results.push(dashboard.failed
      ? { name: 'Dashboard', status: 'failed', note: `${dashboard.error} — see ${dashboard.logPath}` }
      : { name: 'Dashboard', url: dashboard.url, status: dashboard.reused ? 'reused' : 'started' });
  }

  const telemetryUrl = liveEnv.CONSTRUCT_TELEMETRY_URL ?? '';
  const traceBackend = resolveTraceBackend(liveEnv);
  if (wants('telemetry')) {
    if (traceBackend === 'local') {
      results.push({
        name: 'Telemetry',
        url: path.join(rootDir, '.cx', 'traces'),
        status: 'configured',
        note: 'local JSONL traces; remote export not configured',
      });
    } else if (traceBackend === 'none') {
      results.push({
        name: 'Telemetry',
        url: path.join(rootDir, '.cx', 'traces'),
        status: 'configured',
        note: 'remote export disabled; local JSONL traces preserved',
      });
    } else if (traceBackend === 'otel') {
      const endpoint = liveEnv.CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT || '';
      results.push({
        name: 'Telemetry',
        url: endpoint || undefined,
        status: endpoint ? 'configured' : 'unavailable',
        note: endpoint ? `OTLP export (${telemetryProviderLabel(liveEnv)})` : 'CONSTRUCT_OTEL_EXPORTER_OTLP_ENDPOINT not set',
      });
    } else if (telemetryUrl && (traceBackend === 'langfuse' || traceBackend === 'http')) {
      results.push({
        name: 'Telemetry',
        url: telemetryUrl,
        status: 'configured',
        note: `${telemetryProviderLabel(liveEnv)} export — ${telemetryUrl}`,
      });
    } else {
      results.push({ name: 'Telemetry', status: 'unavailable', note: 'remote export requested but endpoint is not configured' });
    }
  }

  // Memory (cm)
  if (wants('memory') && support.cm) {
    if (await memoryProbeFn(ports.memory)) {
      results.push({ name: 'Memory (cm)', url: `http://127.0.0.1:${ports.memory}`, status: 'reused' });
    } else {
      spawnDetachedFn('cm', ['serve', '--port', String(ports.memory)], homeDir, 'cm.log');
      results.push({ name: 'Memory (cm)', url: `http://127.0.0.1:${ports.memory}`, status: 'started' });
    }
  } else if (wants('memory')) {
    results.push({ name: 'Memory (cm)', status: 'unavailable', note: 'cm not installed — run: construct init or brew install dicklesworthstone/tap/cm' });
  }

  // OpenCode (optional)
  if (wants('opencode') && support.opencode) {
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

function killPortOwners(port, spawnSyncFn = spawnSync) {
  if (!port || !Number.isInteger(port) || port <= 0) return false;
  try {
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
  spawnSyncFn = spawnSync,
} = {}) {
  const results = [];

  const doctor = stopDoctor(homeDir);
  if (doctor.stopped) {
    results.push({ name: 'Doctor', status: 'stopped', note: `pid ${doctor.pid}` });
  } else if (doctor.reason === 'stale-state') {
    results.push({ name: 'Doctor', status: 'cleaned', note: 'stale state file removed' });
  }

  const dashboard = stopDashboard(homeDir);
  if (dashboard.stopped) {
    results.push({ name: 'Dashboard', status: 'stopped', note: `pid ${dashboard.pid}, port ${dashboard.port}` });
  } else if (dashboard.reason === 'stale-state') {
    results.push({ name: 'Dashboard', status: 'cleaned', note: 'stale state file removed (process already gone)' });
  } else {
    results.push({ name: 'Dashboard', status: 'not-running' });
  }

  const envPath = getUserEnvPath(homeDir);
  const envValues = parseEnvFile(envPath);
  const memoryPort = Number(envValues.MEMORY_PORT) || derivedMemoryPort();
  const cmKilled = killPortOwners(memoryPort, spawnSyncFn);
  results.push({ name: 'Memory (cm)', status: cmKilled ? 'stopped' : 'not-running' });

  const bridgePort = Number(envValues.BRIDGE_PORT) || 5173;
  const openCodeKilled = killPortOwners(bridgePort, spawnSyncFn);
  results.push({ name: 'OpenCode', status: openCodeKilled ? 'stopped' : 'not-running' });

  const stopped = results.filter((r) => r.status === 'stopped' || r.status === 'cleaned').map((r) => r.name);
  return { stopped, results };
}
