/**
 * lib/service-manager.mjs — start, stop, and describe Construct runtime services.
 *
 * Manages the dashboard process, local Langfuse (Docker), memory server (cm),
 * and OpenCode. startServices() is the single entry point for `construct up`;
 * it spawns whatever is available and returns a result per service.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findAvailablePort } from './host-capabilities.mjs';
import { getUserEnvPath, loadConstructEnv, writeEnvValues } from './env-config.mjs';
import { detectDockerCompose } from './setup.mjs';

const DASHBOARD_STATE_FILE = 'dashboard.json';

const LANGFUSE_LOCAL_BASEURL = 'http://localhost:3000';
const LANGFUSE_LOCAL_PUBLIC_KEY = 'pk-lf-construct-local';
const LANGFUSE_LOCAL_SECRET_KEY = 'sk-lf-construct-local';

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

function spawnDetached(command, args, homeDir, logFile) {
  const logPath = path.join(runtimeStateDir(homeDir), logFile);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, { detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  return child;
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
  if (existing) return { started: false, reused: true, pid: existing.pid, port: existing.port, url: existing.url };

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

export async function getRuntimePorts(homeDir = os.homedir()) {
  const dashboard = readDashboardState(homeDir);
  return {
    dashboard: dashboard?.port ?? await findAvailablePort(4242),
    memory: await findAvailablePort(8765),
    bridge: await findAvailablePort(5173),
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

export async function startServices({ rootDir, homeDir = os.homedir() } = {}) {
  const support = await describeRuntimeSupport();
  const ports = await getRuntimePorts(homeDir);
  const envPath = getUserEnvPath(homeDir);

  writeEnvValues(envPath, {
    DASHBOARD_PORT: String(ports.dashboard),
    MEMORY_PORT: String(ports.memory),
    BRIDGE_PORT: String(ports.bridge),
  });

  const results = [];

  // Dashboard
  const dashboard = await startDashboard({ rootDir, homeDir, preferredPort: ports.dashboard });
  results.push({
    name: 'Dashboard',
    url: dashboard.url,
    status: dashboard.reused ? 'reused' : 'started',
  });

  // Langfuse — start local Docker unless a remote URL is explicitly configured
  const liveEnv = loadConstructEnv({ rootDir, homeDir });
  const langfuseUrl = liveEnv.LANGFUSE_BASEURL ?? '';
  const isRemoteLangfuse = langfuseUrl && !langfuseUrl.includes('localhost') && !langfuseUrl.includes('127.0.0.1');

  if (isRemoteLangfuse) {
    results.push({ name: 'Langfuse', url: langfuseUrl, status: 'configured' });
  } else {
    const composeRunner = detectDockerCompose();
    if (composeRunner) {
      const composeFile = path.join(rootDir, 'langfuse', 'docker-compose.yml');
      const r = spawnSync(
        composeRunner.command,
        [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile, 'up', '-d'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      if (r.status === 0) {
        writeEnvValues(envPath, {
          LANGFUSE_BASEURL: LANGFUSE_LOCAL_BASEURL,
          LANGFUSE_PUBLIC_KEY: LANGFUSE_LOCAL_PUBLIC_KEY,
          LANGFUSE_SECRET_KEY: LANGFUSE_LOCAL_SECRET_KEY,
        });
        results.push({ name: 'Langfuse', url: LANGFUSE_LOCAL_BASEURL, status: 'started', note: 'containers starting — allow 30-60s' });
      } else {
        const msg = (r.stderr || r.stdout || 'docker compose failed').trim().split('\n')[0];
        results.push({ name: 'Langfuse', status: 'failed', note: msg });
      }
    } else {
      results.push({ name: 'Langfuse', status: 'unavailable', note: 'Docker not available' });
    }
  }

  // Memory (cm)
  if (support.cm) {
    spawnDetached('cm', ['serve', '--port', String(ports.memory)], homeDir, 'cm.log');
    results.push({ name: 'Memory (cm)', url: `http://127.0.0.1:${ports.memory}`, status: 'started' });
  } else {
    results.push({ name: 'Memory (cm)', status: 'unavailable', note: 'cm not installed — run: construct setup or brew install dicklesworthstone/tap/cm' });
  }

  // OpenCode (optional)
  if (support.opencode) {
    spawnDetached('opencode', ['serve', '--port', String(ports.bridge)], homeDir, 'opencode.log');
    results.push({ name: 'OpenCode', url: `http://127.0.0.1:${ports.bridge}`, status: 'started' });
  }

  return { support, ports, results };
}

export async function stopServices({ homeDir = os.homedir() } = {}) {
  const dashboard = stopDashboard(homeDir);
  return {
    stopped: dashboard.stopped ? ['dashboard'] : [],
    guidance: dashboard.stopped
      ? []
      : ['Stop Construct-related services with their native commands or your process manager.'],
    dashboard,
  };
}
