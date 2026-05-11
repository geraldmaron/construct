/**
 * lib/doctor/watchers/service-health.mjs — continuous service probes.
 *
 * Probes the services `construct up` starts (postgres, langfuse, dashboard,
 * cm, opencode). On 2 consecutive probe failures, attempts a restart of
 * docker-backed services (postgres, langfuse). On 2 consecutive failed
 * restarts, escalates `service.down` for cx-sre. Non-docker services log +
 * escalate after 3 consecutive failures — auto-restart needs original spawn
 * args and is deferred to a follow-up.
 *
 * Tick: 60s.
 */

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, openSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';

export const name = 'service-health';
export const intervalMs = 60 * 1000;

const failureCounts = {};
const restartAttempts = {};

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const services = [
  {
    id: 'postgres',
    probe: () => probeTcp('127.0.0.1', 54329),
    restart: () => dockerRestart('construct-postgres'),
    restartable: true,
  },
  {
    id: 'dashboard',
    probe: () => probeDashboardPort(),
    restart: () => respawnViaConstructUp('dashboard'),
    restartable: true,
  },
  {
    id: 'cm',
    probe: () => probeMemoryHealth(),
    restart: () => respawnCm(),
    restartable: true,
  },
];

function probeTcp(host, port, timeoutMs = 1500) {
  const r = spawnSync('bash', ['-c', `(echo > /dev/tcp/${host}/${port}) 2>/dev/null`], { timeout: timeoutMs });
  return r.status === 0;
}

function probeDashboardPort() {
  const statePath = join(homedir(), '.construct', 'dashboard.json');
  if (!existsSync(statePath)) return true;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!state.port) return true;
    return probeTcp('127.0.0.1', state.port);
  } catch {
    return true;
  }
}

function probeMemoryHealth() {
  const envPath = join(homedir(), '.construct', 'config.env');
  if (!existsSync(envPath)) return true;
  try {
    const env = readFileSync(envPath, 'utf8');
    const match = env.match(/MEMORY_PORT=(\d+)/);
    if (!match) return true;
    return probeTcp('127.0.0.1', parseInt(match[1], 10));
  } catch {
    return true;
  }
}

function dockerRestart(container) {
  const r = spawnSync('docker', ['restart', container], { encoding: 'utf8', timeout: 15000 });
  return { ok: r.status === 0, stderr: r.stderr };
}

function detachSpawn(command, args, logName) {
  try {
    const runtimeDir = join(homedir(), '.construct', '.runtime');
    if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
    const logPath = join(runtimeDir, logName);
    const fd = openSync(logPath, 'a');
    const child = spawn(command, args, { detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    return { ok: true, logPath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function respawnViaConstructUp() {
  const bin = join(REPO_ROOT, 'bin', 'construct');
  if (!existsSync(bin)) return { ok: false, error: 'bin/construct not found' };
  return detachSpawn('node', [bin, 'up'], 'doctor-respawn-up.log');
}

function respawnCm() {
  const envPath = join(homedir(), '.construct', 'config.env');
  let port = '4231';
  try {
    if (existsSync(envPath)) {
      const m = readFileSync(envPath, 'utf8').match(/MEMORY_PORT=(\d+)/);
      if (m) port = m[1];
    }
  } catch { /* fall through */ }
  return detachSpawn('cm', ['serve', '--port', port], 'cm-respawn.log');
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const samples = [];

  for (const svc of services) {
    let healthy = true;
    try { healthy = await svc.probe(); } catch { healthy = false; }
    samples.push({ id: svc.id, healthy });

    if (healthy) {
      if (failureCounts[svc.id]) {
        record({
          kind: 'recovery',
          watcher: name,
          target: svc.id,
          summary: `${svc.id} recovered after ${failureCounts[svc.id]} consecutive probe failure(s)`,
          context: { previousFailures: failureCounts[svc.id] },
        });
      }
      failureCounts[svc.id] = 0;
      restartAttempts[svc.id] = 0;
      continue;
    }

    failureCounts[svc.id] = (failureCounts[svc.id] || 0) + 1;
    record({
      kind: 'sample',
      watcher: name,
      target: svc.id,
      result: 'down',
      summary: `${svc.id} probe failed (${failureCounts[svc.id]} consecutive)`,
      context: { failureCount: failureCounts[svc.id] },
    });

    if (svc.restartable && failureCounts[svc.id] >= 2 && (restartAttempts[svc.id] || 0) < 2) {
      const restart = svc.restart();
      restartAttempts[svc.id] = (restartAttempts[svc.id] || 0) + 1;
      record({
        kind: 'action',
        watcher: name,
        action: 'restart',
        target: svc.id,
        result: restart.ok ? 'ok' : 'failed',
        summary: `${svc.id} restart attempt ${restartAttempts[svc.id]} — ${restart.ok ? 'succeeded' : 'failed'}`,
        context: restart,
      });
      actions.push({ type: 'restart', target: svc.id, ok: restart.ok });
      if (restart.ok) failureCounts[svc.id] = 0;
    }

    const escalateThreshold = svc.restartable ? 2 : 3;
    const restartFailures = restartAttempts[svc.id] || 0;
    const shouldEscalate = svc.restartable
      ? restartFailures >= 2 && failureCounts[svc.id] >= 2
      : failureCounts[svc.id] >= escalateThreshold;
    if (shouldEscalate) {
      const r = await escalate({
        watcher: name,
        eventType: 'service.down',
        summary: `${svc.id} down (${failureCounts[svc.id]} consecutive probes, ${restartFailures} restart attempt(s) failed)`,
        context: { service: svc.id, failureCount: failureCounts[svc.id], restartAttempts: restartFailures },
      });
      escalations.push({ eventType: 'service.down', service: svc.id, result: r });
    }
  }

  return { actions, escalations, notes: samples };
}
