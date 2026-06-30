/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the memory server (cm), OpenCode, and other runtime services.
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

const INSTALL_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function runtimeStateDir(homeDir = os.homedir()) {
  return path.join(stateDir(homeDir), 'runtime');
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

// Opt-in 1Password resolution (ADR-0049 Design A): each long-lived service launches
// under `op run --env-file -- <cmd>` so op:// references resolve once at this stable
// parent and every child inherits resolved provider keys. wrapWithOpRun returns the
// command unchanged when CONSTRUCT_OP_ENV_FILE is unset, the file is missing, or `op`
// is absent, so the un-opted path is byte-for-byte the prior behavior. The env that
// carries CONSTRUCT_OP_ENV_FILE is options.env when a site sets one (doctor, oracle)
// and process.env otherwise (cm, opencode, copilot bridge).

function wrapServiceSpawn(command, args, homeDir, options = {}) {
  const env = options.env || process.env;
  const wrapped = wrapWithOpRun(command, args, { env, homeDir });
  return { command: wrapped.command, args: wrapped.args };
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
  const doctorEnv = { ...process.env };
  const launch = wrapServiceSpawn('node', [indexPath], homeDir, { env: doctorEnv });
  const { logPath } = spawnDetached(launch.command, launch.args, homeDir, 'doctor.log', { cwd: rootDir, env: doctorEnv });
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
  const oracleEnv = {
    ...process.env,
    CONSTRUCT_ORACLE_ROOT: rootDir,
    CONSTRUCT_ORACLE_PROJECT: projectDir,
  };
  const launch = wrapServiceSpawn('node', [entry], homeDir, { env: oracleEnv });
  const { logPath } = spawnDetached(launch.command, launch.args, homeDir, 'oracle-daemon.log', {
    cwd: projectDir,
    env: oracleEnv,
  });
  return { started: true, logPath };
}

export async function getRuntimePorts(homeDir = os.homedir(), {
  memoryProbeFn = isMemoryRunning,
  openCodeProbeFn = isBridgeRunning,
  findAvailablePortFn = findAvailablePort,
} = {}) {
  const existing = parseEnvFile(getUserEnvPath(homeDir));

  async function resolvePort(key, fallback, probe = async (port) => probeRuntimePort(port)) {
    const saved = Number(existing[key]);
    if (Number.isFinite(saved) && saved > 0) {
      if (await probe(saved)) return saved;
    }
    return findAvailablePortFn(saved || fallback);
  }

  return {
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
      const cm = wrapServiceSpawn('cm', ['serve', '--port', String(ports.memory)], homeDir, { env: liveEnv });
      const cmSpawn = spawnDetachedFn(cm.command, cm.args, homeDir, 'cm.log');
      try {
        if (cmSpawn?.child?.pid) {
          writeJson(portOwnershipPath(ports.memory, homeDir), {
            pid: cmSpawn.child.pid, command: `${cm.command} ${cm.args.join(' ')}`,
            cwd: process.cwd(), marker: 'construct', constructManaged: true,
            startedAt: new Date().toISOString(),
          });
        }
      } catch { /* ownership record is advisory */ }
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
      const opencode = wrapServiceSpawn('opencode', ['serve', '--port', String(ports.bridge)], homeDir, { env: liveEnv });
      const ocSpawn = spawnDetachedFn(opencode.command, opencode.args, homeDir, 'opencode.log');
      try {
        if (ocSpawn?.child?.pid) {
          writeJson(portOwnershipPath(ports.bridge, homeDir), {
            pid: ocSpawn.child.pid, command: `${opencode.command} ${opencode.args.join(' ')}`,
            cwd: process.cwd(), marker: 'construct', constructManaged: true,
            startedAt: new Date().toISOString(),
          });
        }
      } catch { /* ownership record is advisory */ }
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
          const copilot = wrapServiceSpawn('node', [proxyPath, '--port', String(ports.copilotBridge)], homeDir, { env: liveEnv });
          const copilotSpawn = spawnDetachedFn(copilot.command, copilot.args, homeDir, 'copilot-bridge.log');
          try {
            if (copilotSpawn?.child?.pid) {
              writeJson(portOwnershipPath(ports.copilotBridge, homeDir), {
                pid: copilotSpawn.child.pid, command: `${copilot.command} ${copilot.args.join(' ')}`,
                cwd: process.cwd(), marker: 'construct', constructManaged: true,
                startedAt: new Date().toISOString(),
              });
            }
          } catch { /* ownership record is advisory */ }
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

// Ownership record path for a port. startServices writes one when it spawns a service;
// killPortOwners reads it before sending SIGTERM so a foreign process that happens to
// occupy a configured port is never signalled.

function portOwnershipPath(port, homeDir) {
  return path.join(runtimeStateDir(homeDir), `port-${port}.json`);
}

// Predicate: does a process record represent a Construct-owned service? A record is
// owned when it carries a Construct env/marker set at spawn time. A foreign process or
// a record from before the ownership contract was introduced is not owned.

export function isConstructOwnedPort(processRecord, { port } = {}) {
  if (!processRecord || typeof processRecord !== 'object') return false;
  return Boolean(processRecord.marker === 'construct' || processRecord.constructManaged === true);
}

function killPortOwners(port, spawnSyncFn = spawnSync, homeDir = os.homedir()) {
  if (!port || !Number.isInteger(port) || port <= 0) return false;
  try {
    const result = spawnSyncFn('lsof', ['-t', `-i:${port}`], { encoding: 'utf8' });
    const pids = (result.stdout || '').trim().split(/\s+/).filter(Boolean).map(Number).filter((n) => n > 0);
    if (pids.length === 0) return false;

    // Only signal a PID if we have a durable Construct ownership record for this port
    // AND it names this exact PID. A foreign owner gets reported, not killed.
    const ownerRecord = readJson(portOwnershipPath(port, homeDir));
    let killed = false;
    for (const pid of pids) {
      if (!ownerRecord || ownerRecord.pid !== pid || !isConstructOwnedPort(ownerRecord)) continue;
      try { process.kill(pid, 'SIGTERM'); killed = true; } catch { /* already gone */ }
    }
    return killed;
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

  const envPath = getUserEnvPath(homeDir);
  const envValues = parseEnvFile(envPath);
  const memoryPort = Number(envValues.MEMORY_PORT) || derivedMemoryPort();
  const cmKilled = killPortOwners(memoryPort, spawnSyncFn, homeDir);
  results.push({ name: 'Memory (cm)', status: cmKilled ? 'stopped' : 'not-running' });

  const bridgePort = Number(envValues.BRIDGE_PORT) || 5173;
  const openCodeKilled = killPortOwners(bridgePort, spawnSyncFn, homeDir);
  results.push({ name: 'OpenCode', status: openCodeKilled ? 'stopped' : 'not-running' });

  const copilotBridgePort = Number(envValues.COPILOT_BRIDGE_PORT) || 5174;
  const copilotBridgeKilled = killPortOwners(copilotBridgePort, spawnSyncFn, homeDir);
  results.push({ name: 'Copilot Bridge', status: copilotBridgeKilled ? 'stopped' : 'not-running' });

  const stopped = results.filter((r) => r.status === 'stopped' || r.status === 'cleaned').map((r) => r.name);
  return { stopped, results };
}
