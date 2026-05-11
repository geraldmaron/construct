/**
 * lib/doctor/index.mjs — `construct-doctor` daemon main loop.
 *
 * Long-running Node process spawned by `construct up`. Holds the L0 watchers
 * for resource pressure, service health, disk + log rotation, and cost. Each
 * watcher ticks on its own interval; the loop is bounded so a slow watcher
 * never starves the others. Termination via SIGTERM/SIGINT triggers a clean
 * shutdown that records a final audit entry.
 *
 * State file: ~/.construct/doctor.json (pid, started, lastTick).
 * Audit log:  ~/.cx/doctor-log.jsonl.
 */

import { writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { record } from './audit.mjs';
import * as disk from './watchers/disk.mjs';
import * as cost from './watchers/cost.mjs';
import * as processPressure from './watchers/process-pressure.mjs';
import * as serviceHealth from './watchers/service-health.mjs';

const STATE_PATH = join(homedir(), '.construct', 'doctor.json');
const WATCHERS = [disk, cost, processPressure, serviceHealth];

let running = false;
let timers = [];
let lastTickAt = {};

function writeState(state) {
  const dir = join(homedir(), '.construct');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: Date.now() }));
}

function clearState() {
  if (existsSync(STATE_PATH)) {
    try { unlinkSync(STATE_PATH); } catch { /* best effort */ }
  }
}

export function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

async function runWatcher(watcher) {
  if (!running) return;
  const startedAt = Date.now();
  try {
    const result = await watcher.tick();
    lastTickAt[watcher.name] = startedAt;
    const tookMs = Date.now() - startedAt;
    if (process.env.CONSTRUCT_DOCTOR_VERBOSE === '1') {
      process.stderr.write(
        `[doctor] ${watcher.name} ok ${tookMs}ms actions=${result.actions?.length || 0} escalations=${result.escalations?.length || 0}\n`
      );
    }
  } catch (err) {
    record({
      kind: 'error',
      watcher: watcher.name,
      result: 'failed',
      summary: `tick failed: ${err.message || err}`,
      context: { stack: String(err.stack || '').slice(0, 1024) },
    });
  }
}

export async function start() {
  if (running) return;
  running = true;
  lastTickAt = {};

  writeState({ pid: process.pid, startedAt: Date.now(), watchers: WATCHERS.map((w) => w.name) });
  record({
    kind: 'lifecycle',
    watcher: 'doctor',
    action: 'start',
    summary: `doctor started (pid ${process.pid}, ${WATCHERS.length} watchers)`,
    context: { watchers: WATCHERS.map((w) => ({ name: w.name, intervalMs: w.intervalMs })) },
  });

  for (const watcher of WATCHERS) {
    await runWatcher(watcher);
    const t = setInterval(() => { runWatcher(watcher); }, watcher.intervalMs);
    if (t.unref) t.unref();
    timers.push(t);
  }

  const shutdown = (signal) => {
    record({ kind: 'lifecycle', watcher: 'doctor', action: 'stop', summary: `doctor stopped (signal=${signal})` });
    stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export function stop() {
  running = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  clearState();
}

export function statusSnapshot() {
  const state = readState();
  return {
    running: !!state,
    state,
    watchers: WATCHERS.map((w) => ({
      name: w.name,
      intervalMs: w.intervalMs,
      lastTickAt: lastTickAt[w.name] || null,
    })),
  };
}

const isMain = (() => {
  try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; }
})();
if (isMain) {
  await start();
}
