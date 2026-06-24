/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the dashboard process, memory server (cm), and OpenCode. 
 * startServices() is the single entry point for `construct dev` —
 * spawns whatever is available and returns a result per service.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findAvailablePort } from './host-capabilities.mjs';
import { wrapWithOpRun } from './providers/op-run.mjs';
import { getUserEnvPath, loadConstructEnv, parseEnvFile, writeEnvValues } from './env-config.mjs';
import { runPressureRelease } from './runtime-pressure.mjs';
import { resolveTraceBackend, telemetryProviderLabel } from './telemetry/client.mjs';
import { memoryPort as derivedMemoryPort } from './home-namespace.mjs';
import { readHeartbeat } from './daemons/contract.mjs';
import { heartbeatPath } from './oracle/index.mjs';
import { stateDir } from './config/xdg.mjs';
import { doctorRoot } from './config/xdg.mjs';

const DASHBOARD_STATE_FILE = 'dashboard.json';

const INSTALL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtimeStateDir(homeDir = os.homedir()) {
  return path.join(stateDir(homeDir), 'runtime');
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
    userDataRoot: env.CX_DATA_DIR || doctorRoot(homeDir),
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
  // Local Postgres lifecycle is out of Construct's scope, so no URL is Construct-managed.
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

async function isBridgeRunning(port) {
  return probeRuntimeHttp(`http://127.0.0.1:${port}/`, { timeoutMs: 1000 });
}

async function isCopilotBridgeRunning(port) {
  // Check if the port is reachable.
  return probeRuntimePort(port);
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
  return path.join(stateDir(homeDir), 'doctor.json');
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

export function startOracle({ rootDir, homeDir = os.homedir(), projectDir = rootDir } = {}) {
  if (process.env.CONSTRUCT_ORACLE === 'off' || process.env.CONSTRUCT_ORACLE === '0') {
    return { started: false, reason: 'disabled' };
  }
  const entry = path.join(INSTALL_ROOT, 'lib', 'oracle', 'daemon-entry.mjs');
  if (!fs.existsSync(entry)) return { started: false, reason: 'missing-binary' };
  const live = readHeartbeat(heartbeatPath(homeDir));
  if (live) return { started: false, reused: true, pid: live.pid };
  const { logPath } = spawnDetached('node', [entry], homeDir, 'oracle-daemon.log', {
    cwd: projectDir,
    env: {
      ...process.env,
      CONSTRUCT_ORACLE_ROOT: rootDir,
      CONSTRUCT_ORACLE_PROJECT: projectDir,
    },
  });
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

  // Opt-in: with CONSTRUCT_OP_ENV_FILE set, launch the daemon under `op run` so
  // 1Password op:// refs resolve once at startup into its env. The biometric
  // unlock prompt makes first launch slower, so widen the readiness window then.
  const { command, args, wrapped } = wrapWithOpRun(
    process.execPath,
    [path.join(INSTALL_ROOT, 'lib', 'server', 'index.mjs')],
    { env: process.env },
  );
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  let ready = false;
  const maxTries = wrapped ? 150 : 30;
  for (let i = 0; i < maxTries; i += 1) {
    if (await probeRuntimePort(port)) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!ready) {
    let logTail = '';
    try { logTail = fs.readFileSync(outPath, 'utf8').split('\n').slice(-12).join('\n'); } catch { /* log unreadable */ }
    const window = wrapped ? '30s (op run awaits 1Password unlock)' : '6s';
    return { started: false, failed: true, port, logPath: outPath, error: `dashboard did not bind 127.0.0.1:${port} within ${window}`, logTail };
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
  openCodeProbeFn = isBridgeRunning,
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
    copilotBridge: await resolvePort('COPILOT_BRIDGE_PORT', 5174, probeRuntimePort),
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
    gh: commandExists('gh'),
  };
}

export const SELECTABLE_SERVICES = Object.freeze([
  { key: 'dashboard', label: 'Dashboard', description: 'Local operations dashboard on http://127.0.0.1:4242.' },
  { key: 'telemetry', label: 'Telemetry', description: 'Trace export / local JSONL traces.' },
  { key: 'memory', label: 'Memory (cm)', description: 'Persistent memory service (cm).' },
  { key: 'opencode', label: 'OpenCode', description: 'OpenCode bridge server.' },
  { key: 'copilot-bridge', label: 'Copilot Bridge', description: 'Host-native Copilot bridge proxy (requires gh auth).' },
]);

// Construct does not impose an Ollama keep-alive: an operator value is honored when
// present, otherwise the variable is left unset so the Ollama server applies its own
// default and idle models unload on their own. A forced value would keep every
// requested model resident in unified memory for the whole window.

export function resolveOllamaKeepAlive(env = {}) {
  const operatorValue = typeof env?.OLLAMA_KEEP_ALIVE === 'string' ? env.OLLAMA_KEEP_ALIVE.trim() : '';
  return operatorValue || null;
}

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
  openCodeProbeFn = isBridgeRunning,
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
    COPILOT_BRIDGE_PORT: String(ports.copilotBridge),
  });

  const liveEnv = loadConstructEnvFn({ rootDir, homeDir });
  const results = [];

  const operatorKeepAlive = resolveOllamaKeepAlive(liveEnv);
  if (operatorKeepAlive) liveEnv.OLLAMA_KEEP_ALIVE = operatorKeepAlive;

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

  // Copilot Bridge
  if (wants('copilot-bridge') && support.gh) {
    const { detectActiveSessions } = await import('./host-capabilities.mjs');
    const sessions = detectActiveSessions();
    if (sessions.includes('github-copilot')) {
      if (await probeRuntimePort(ports.copilotBridge)) {
        results.push({ name: 'Copilot Bridge', url: `http://127.0.0.1:${ports.copilotBridge}`, status: 'reused' });
      } else {
        const proxyPath = path.join(INSTALL_ROOT, 'lib', 'bridges', 'copilot-proxy.mjs');
        if (fs.existsSync(proxyPath)) {
          spawnDetachedFn('node', [proxyPath, '--port', String(ports.copilotBridge)], homeDir, 'copilot-bridge.log');
          results.push({ name: 'Copilot Bridge', url: `http://127.0.0.1:${ports.copilotBridge}`, status: 'started' });
        } else {
          results.push({ name: 'Copilot Bridge', status: 'unavailable', note: 'copilot-proxy binary missing in lib/bridges/' });
        }
      }
    } else {
      results.push({ name: 'Copilot Bridge', status: 'unavailable', note: 'gh auth status shows no active GitHub session' });
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

  const oracle = startOracle({ rootDir, homeDir, projectDir: rootDir });
  if (oracle.started) {
    results.push({ name: 'Oracle', status: 'started', note: `L0.5 overseer · logs: ${oracle.logPath}` });
  } else if (oracle.reused) {
    results.push({ name: 'Oracle', status: 'reused', note: `pid ${oracle.pid}` });
  } else if (oracle.reason !== 'disabled') {
    results.push({ name: 'Oracle', status: 'unavailable', note: oracle.reason });
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

  const copilotBridgePort = Number(envValues.COPILOT_BRIDGE_PORT) || 5174;
  const copilotBridgeKilled = killPortOwners(copilotBridgePort, spawnSyncFn);
  results.push({ name: 'Copilot Bridge', status: copilotBridgeKilled ? 'stopped' : 'not-running' });

  const stopped = results.filter((r) => r.status === 'stopped' || r.status === 'cleaned').map((r) => r.name);
  return { stopped, results };
}
