/**
 * lib/legacy-cleanup.mjs — kill leaked legacy daemons and purge their stale state.
 *
 * The Oracle (lib/oracle/daemon-entry.mjs) and Doctor (lib/doctor/index.mjs)
 * background daemons are retired (maintainer directive 2026-07-18): no code
 * path spawns them, and any instance still running is a leak from an older
 * install or test run. runLegacyCleanup() finds those processes by command
 * line, sends SIGTERM, and purges their durable state — the oracle runtime
 * dir, the doctor state file, detached-spawn logs, and dead port-ownership
 * records. Idempotent and quiet: a clean machine yields empty results and
 * no writes. Wired into bin/construct-postinstall.mjs (upgrades) and the
 * `construct doctor` CLI (manual runs).
 *
 * Process matching is deliberately narrow: the executable must be node-like
 * AND an argv token must end with the daemon module path, so an editor or
 * grep holding the same filename is never signalled. The matcher is exported
 * so tests exercise the exact production logic.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { stateDir, doctorRoot } from './config/xdg.mjs';

const LEGACY_DAEMON_MODULE_SUFFIXES = [
  ['lib', 'oracle', 'daemon-entry.mjs'].join('/'),
  ['lib', 'doctor', 'index.mjs'].join('/'),
];

function isNodeExecutable(token) {
  const base = path.basename(String(token || '')).toLowerCase();
  return base === 'node' || base === 'node.exe' || /^node[.\d-]/.test(base);
}

export function matchesLegacyDaemonCommand(command) {
  const tokens = String(command || '').trim().split(/\s+/);
  if (tokens.length < 2) return false;
  if (!isNodeExecutable(tokens[0])) return false;
  return tokens.slice(1).some((token) => {
    const normalized = token.replace(/\\/g, '/');
    return LEGACY_DAEMON_MODULE_SUFFIXES.some(
      (suffix) => normalized === suffix || normalized.endsWith(`/${suffix}`),
    );
  });
}

export function parsePsOutput(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), command: m[2] }));
}

function listProcesses() {
  if (process.platform === 'win32') return [];
  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return parsePsOutput(result.stdout);
}

export function findLegacyDaemonProcesses({ psListFn = listProcesses } = {}) {
  const own = new Set([process.pid, process.ppid]);
  return psListFn()
    .filter((p) => Number.isInteger(p.pid) && p.pid > 0 && !own.has(p.pid))
    .filter((p) => matchesLegacyDaemonCommand(p.command));
}

export function killLegacyDaemons({ psListFn = listProcesses, killFn = process.kill } = {}) {
  const killed = [];
  for (const proc of findLegacyDaemonProcesses({ psListFn })) {
    try {
      killFn(proc.pid, 'SIGTERM');
      killed.push(proc);
    } catch {}
  }
  return killed;
}

// Durable footprint of the retired daemons. The oracle runtime dir (heartbeat,
// last-tick, lock, log — lib/oracle/index.mjs runtimeDir()) lives under the
// doctor root; the doctor state file and detached-spawn logs live under the
// XDG state dir (lib/service-manager.mjs doctorStatePath()/spawnDetached()).

function legacyStatePaths(homeDir, env) {
  const runtime = path.join(stateDir(homeDir, env), 'runtime');
  return [
    path.join(doctorRoot(homeDir, env), 'runtime', 'oracle'),
    path.join(stateDir(homeDir, env), 'doctor.json'),
    path.join(runtime, 'doctor.log'),
    path.join(runtime, 'oracle-daemon.log'),
  ];
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Port-ownership records (stateDir/runtime/port-<n>.json) are advisory
// pid+command markers written at service spawn; a record naming a dead pid —
// or one that cannot be parsed — is stale by definition and safe to drop
// regardless of which service wrote it. Records naming a live pid are left
// untouched.

function staleOwnershipRecords(homeDir, env, { processExistsFn = processExists } = {}) {
  const runtime = path.join(stateDir(homeDir, env), 'runtime');
  let entries;
  try {
    entries = fs.readdirSync(runtime).filter((name) => /^port-\d+\.json$/.test(name));
  } catch {
    return [];
  }
  const stale = [];
  for (const name of entries) {
    const filePath = path.join(runtime, name);
    let record = null;
    try {
      record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}
    if (!record || !processExistsFn(Number(record.pid))) stale.push(filePath);
  }
  return stale;
}

export function sweepLegacyState(homeDir = os.homedir(), { env = process.env, processExistsFn = processExists } = {}) {
  const purged = [];
  const targets = [
    ...legacyStatePaths(homeDir, env),
    ...staleOwnershipRecords(homeDir, env, { processExistsFn }),
  ];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
      purged.push(target);
    } catch {}
  }
  return purged;
}

export function runLegacyCleanup({
  homeDir = os.homedir(),
  env = process.env,
  psListFn = listProcesses,
  killFn = process.kill,
  processExistsFn = processExists,
} = {}) {
  const killed = killLegacyDaemons({ psListFn, killFn });
  const purged = sweepLegacyState(homeDir, { env, processExistsFn });
  return { killed, purged };
}
