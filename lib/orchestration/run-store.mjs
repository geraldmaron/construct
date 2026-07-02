/**
 * lib/orchestration/run-store.mjs — filesystem-backed persistence for the local
 * orchestration runtime (Mode-A, zero-dependency).
 *
 * Orchestration runs and their task lifecycle live as JSON under the project's
 * `.cx/runtime/orchestration/runs/`, so a run survives editor/host restarts and
 * is inspectable without a daemon, a database, or Docker. Writes are atomic
 * (temp file then rename) so a crash mid-write cannot leave a half-written run;
 * reads tolerate a corrupt file by skipping it rather than throwing. This is the
 * Mode-A backend; Mode-B/C (SQLite/Postgres) would implement the same load/save
 * surface without changing callers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const RUNTIME_REL = join('.cx', 'runtime', 'orchestration');

let writeCounter = 0;

function projectRoot(cwd) {
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

export function runtimeDir(cwd = process.cwd()) {
  return join(projectRoot(cwd), RUNTIME_REL);
}

function runsDir(cwd) {
  return join(runtimeDir(cwd), 'runs');
}

// Atomic JSON write: a same-directory temp file then rename, which is atomic on
// POSIX filesystems. A per-process counter keeps concurrent writers from
// colliding on the temp name before the rename lands.

function atomicWriteJson(filePath, value) {
  writeCounter = (writeCounter + 1) % 100000;
  const tmp = `${filePath}.${process.pid}.${writeCounter}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, filePath);
}

export function saveRun(cwd, run) {
  const dir = runsDir(cwd);
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, `${run.runId}.json`), run);
  return run;
}

export function loadRun(cwd, runId) {
  if (!runId) return null;
  const file = join(runsDir(cwd), `${runId}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function listRuns(cwd, { limit = 20 } = {}) {
  const dir = runsDir(cwd);
  if (!existsSync(dir)) return [];
  const runs = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      runs.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    } catch {
      /* a corrupt run file is skipped, not fatal to listing */
    }
  }
  runs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return runs.slice(0, limit).map((run) => ({
    runId: run.runId,
    status: run.status,
    executionMode: run.execution?.executionMode || null,
    createdAt: run.createdAt,
    request: run.request?.summary || null,
    // Include fields needed for shapeRun to compute prepareOnly and degraded
    tasks: run.tasks || [],
    degraded: run.degraded ?? run.execution?.degraded ?? false,
    degradationReason: run.degradationReason ?? run.execution?.degradationReason ?? null,
    semantics: run.semantics ?? null,
    plan: run.plan ? {
      intent: run.plan.intent ?? null,
      track: run.plan.track ?? null,
      suggestedWorkflowType: run.plan.suggestedWorkflowType ?? null,
      researchExecutionPolicy: run.plan.researchExecutionPolicy ?? null,
      specialists: run.plan.specialists ?? [],
    } : null,
  }));
}
