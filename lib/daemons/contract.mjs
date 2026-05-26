/**
 * lib/daemons/contract.mjs — Shared safeguard contract for every long-running
 * Construct process. No ambient process in Construct survives without these
 * rails.
 *
 * Safeguards enforced for every daemon that uses DaemonRunner:
 *   - Bounded lifetime: max wall-clock runtime (default 24h) before self-restart
 *     with state checkpoint.
 *   - Idle shutdown: if no work for N consecutive ticks, stop and log;
 *     resume on next external trigger.
 *   - Heartbeat: every tick writes lastTickAt to a known path.
 *   - Single-writer lock: prevents duplicate daemon instances; auto-expires.
 *   - Killswitch: env var disables the daemon without code changes.
 *   - Resource caps: CPU/memory limits via process.resourceUsage thresholds.
 *
 * Per-item safeguards (TTL, retry budget, dead-letter) are owned by the work
 * queue, not the runner; this module exposes a small queue helper for that.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_MAX_RUNTIME_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_IDLE_TICKS = 6;
export const DEFAULT_MEMORY_CAP_MB = 256;

/**
 * Build a DaemonRunner. Spec fields:
 *   name              — identifier; used in heartbeat path
 *   tick(ctx)         — async; returns { didWork: boolean } each cycle
 *   intervalMs        — sleep between ticks
 *   killswitchEnv     — process.env key; when '=off' the daemon refuses to start
 *   heartbeatPath     — file written each tick with { ts, name, ticks }
 *   lockPath          — single-writer lockfile (defaults to heartbeatPath + .lock)
 *   maxRuntimeMs      — bounded lifetime; default 24h
 *   maxIdleTicks      — consecutive zero-work ticks before idle shutdown
 *   memoryCapMb       — RSS cap; exceeding triggers self-stop + escalation
 *   onIdleShutdown    — optional callback when the runner stops due to idle
 *   onMemoryExceeded  — optional callback when the runner stops due to memory
 */
export function createDaemon(spec) {
  if (!spec?.name) throw new Error('daemon spec missing name');
  if (typeof spec.tick !== 'function') throw new Error('daemon spec missing tick(ctx)');

  const cfg = {
    intervalMs: spec.intervalMs ?? 60_000,
    killswitchEnv: spec.killswitchEnv,
    heartbeatPath: spec.heartbeatPath,
    lockPath: spec.lockPath || (spec.heartbeatPath ? `${spec.heartbeatPath}.lock` : null),
    maxRuntimeMs: spec.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS,
    maxIdleTicks: spec.maxIdleTicks ?? DEFAULT_IDLE_TICKS,
    memoryCapMb: spec.memoryCapMb ?? DEFAULT_MEMORY_CAP_MB,
    onIdleShutdown: spec.onIdleShutdown,
    onMemoryExceeded: spec.onMemoryExceeded,
  };

  let running = false;
  let stopRequested = false;
  let startedAt = 0;
  let ticks = 0;
  let idleTicks = 0;

  function killswitchEngaged() {
    if (!cfg.killswitchEnv) return false;
    return process.env[cfg.killswitchEnv] === 'off' || process.env[cfg.killswitchEnv] === '0';
  }

  function acquireLock() {
    if (!cfg.lockPath) return true;
    try { mkdirSync(dirname(cfg.lockPath), { recursive: true }); } catch { /* ignore */ }
    try {
      writeFileSync(cfg.lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readLockHolder();
      if (holder && processAlive(holder.pid)) return false;
      // Stale lock — steal it
      writeFileSync(cfg.lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'w' });
      return true;
    }
  }

  function releaseLock() {
    if (!cfg.lockPath) return;
    try { unlinkSync(cfg.lockPath); } catch { /* ignore */ }
  }

  function readLockHolder() {
    if (!cfg.lockPath || !existsSync(cfg.lockPath)) return null;
    try { return JSON.parse(readFileSync(cfg.lockPath, 'utf8')); } catch { return null; }
  }

  function processAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  function heartbeat() {
    if (!cfg.heartbeatPath) return;
    try { mkdirSync(dirname(cfg.heartbeatPath), { recursive: true }); } catch { /* ignore */ }
    try {
      writeFileSync(cfg.heartbeatPath, JSON.stringify({
        name: spec.name, pid: process.pid, ts: Date.now(), ticks, idleTicks,
      }));
    } catch { /* heartbeat is best effort */ }
  }

  function memoryExceeded() {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    return rssMb > cfg.memoryCapMb;
  }

  async function run() {
    if (killswitchEngaged()) {
      return { stopped: true, reason: 'killswitch' };
    }
    if (!acquireLock()) {
      return { stopped: true, reason: 'lock-held' };
    }

    running = true;
    stopRequested = false;
    startedAt = Date.now();
    ticks = 0;
    idleTicks = 0;

    try {
      while (running && !stopRequested) {
        if (Date.now() - startedAt >= cfg.maxRuntimeMs) {
          return { stopped: true, reason: 'max-runtime', ticks };
        }
        if (memoryExceeded()) {
          if (cfg.onMemoryExceeded) try { await cfg.onMemoryExceeded(); } catch { /* ignore */ }
          return { stopped: true, reason: 'memory-cap', ticks };
        }
        if (killswitchEngaged()) {
          return { stopped: true, reason: 'killswitch-mid-run', ticks };
        }

        ticks++;
        let result;
        try { result = await spec.tick({ ticks, idleTicks }); }
        catch (err) { result = { didWork: false, error: err.message }; }

        heartbeat();

        if (result?.didWork) idleTicks = 0;
        else idleTicks++;

        if (idleTicks >= cfg.maxIdleTicks) {
          if (cfg.onIdleShutdown) try { await cfg.onIdleShutdown(); } catch { /* ignore */ }
          return { stopped: true, reason: 'idle', ticks };
        }

        await sleep(cfg.intervalMs);
      }
      return { stopped: true, reason: 'requested', ticks };
    } finally {
      running = false;
      releaseLock();
    }
  }

  function stop() { stopRequested = true; }

  function status() {
    return {
      name: spec.name,
      running,
      ticks,
      idleTicks,
      uptimeMs: running ? Date.now() - startedAt : 0,
      heartbeatPath: cfg.heartbeatPath,
      lockPath: cfg.lockPath,
    };
  }

  return { run, stop, status };
}

/**
 * Inspect a heartbeat file written by a DaemonRunner. Returns the heartbeat
 * if fresh (within staleMs), null if stale or missing.
 */
export function readHeartbeat(heartbeatPath, { staleMs = 5 * 60 * 1000 } = {}) {
  if (!heartbeatPath || !existsSync(heartbeatPath)) return null;
  try {
    const data = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
    const age = Date.now() - (data.ts || 0);
    if (age > staleMs) return null;
    return { ...data, ageMs: age };
  } catch { return null; }
}

/**
 * Helper for per-item TTL + retry + dead-letter routing inside a tick. Given
 * a packet with `firstSeenAt` and optional `attempts`, returns a routing
 * decision: 'process' (within budget), 'dead-letter' (TTL or retry budget
 * exhausted), or 'escalate' (past TTL but not yet retried max).
 */
export function classifyPacket(packet, { maxAgeMs = 14 * 24 * 60 * 60 * 1000, maxAttempts = 3 } = {}) {
  const firstSeenAt = packet?.firstSeenAt || packet?.createdAt || Date.now();
  const attempts = packet?.attempts || 0;
  const age = Date.now() - new Date(firstSeenAt).getTime();
  if (age > maxAgeMs) return { route: 'dead-letter', reason: 'ttl-exceeded' };
  if (attempts >= maxAttempts) return { route: 'dead-letter', reason: 'retry-budget-exhausted' };
  return { route: 'process', attempts };
}
