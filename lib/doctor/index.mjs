/**
 * lib/doctor/index.mjs — `construct-doctor` daemon main loop.
 *
 * Long-running Node process spawned by `construct dev`. Holds the L0 watchers
 * for resource pressure, service health, disk + log rotation, and cost. Each
 * watcher ticks on its own interval; the loop is bounded so a slow watcher
 * never starves the others. Termination via SIGTERM/SIGINT triggers a clean
 * shutdown that records a final audit entry.
 *
 * State file: doctor.json in the XDG state dir (pid, started, lastTick).
 * Audit log:  ~/.construct/doctor-log.jsonl.
 */

import { writeFileSync, existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { record } from './audit.mjs';
import { enableSecretAuditTrail } from '../providers/secret-audit-wiring.mjs';
import * as disk from './watchers/disk.mjs';
import * as cost from './watchers/cost.mjs';
import * as processPressure from './watchers/process-pressure.mjs';
import * as serviceHealth from './watchers/service-health.mjs';
import * as bdWatch from './watchers/bd-watch.mjs';
import * as handoffs from './watchers/handoffs.mjs';
import * as consistency from './watchers/consistency.mjs';
import * as mcpProtocol from './watchers/mcp-protocol.mjs';
import * as constructBudget from './watchers/construct-budget.mjs';
import * as graphStaleness from './watchers/graph-staleness.mjs';
import * as providerBreaker from './watchers/provider-breaker.mjs';
import * as orchestrationRuns from './watchers/orchestration-runs.mjs';
import * as sourceTargets from './watchers/source-targets.mjs';
import * as sourceWatch from './watchers/source-watch.mjs';
import * as writePipeline from './watchers/write-pipeline.mjs';
import * as degradation from './watchers/degradation.mjs';
import { stateDir } from '../config/xdg.mjs';
import { isMainModule } from '../roots.mjs';

const STATE_PATH = join(stateDir(), 'doctor.json');
const WATCHERS = [disk, cost, processPressure, serviceHealth, bdWatch, handoffs, consistency, mcpProtocol, constructBudget, graphStaleness, providerBreaker, orchestrationRuns, sourceTargets, sourceWatch, writePipeline, degradation];

let running = false;
let timers = [];
let lastTickAt = {};

// Most watchers read only global/XDG state; projectDir is threaded through
// runWatcher()/tick(ctx) for any watcher that needs project-scoped reads,
// so a test can drive tick() against a fixture project without touching the
// process-wide cwd. start() defaults to process.cwd().

let currentProjectDir = process.cwd();

function writeState(state) {
  const dir = stateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, updatedAt: Date.now() }));
}

function clearState() {
  if (existsSync(STATE_PATH)) {
    try { unlinkSync(STATE_PATH); } catch { /* best effort */ }
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (!processAlive(state.pid)) {
      clearState();
      return null;
    }
    return state;
  } catch { return null; }
}

async function runWatcher(watcher) {
  if (!running) return;
  const startedAt = Date.now();
  try {
    const result = await watcher.tick({ projectDir: currentProjectDir });
    lastTickAt[watcher.name] = startedAt;
    const prior = readState();
    if (prior) {
      writeState({
        ...prior,
        lastEvidenceAt: startedAt,
        lastWatcher: watcher.name,
      });
    }
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

export async function start({ projectDir = process.cwd() } = {}) {
  if (running) return;
  running = true;
  lastTickAt = {};
  currentProjectDir = projectDir;

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
  try { return isMainModule(import.meta.url); } catch { return false; }
})();
if (isMain) {
  // A long-lived daemon in its own process: wire the audit sink at the entry so any
  // credential resolution a watcher performs is recorded on the shared trail rather
  // than escaping it, matching the CLI entrypoint's own wiring.
  enableSecretAuditTrail();
  await start();
}
