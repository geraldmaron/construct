/**
 * lib/resources/budget.mjs — disk-budget enforcement for Construct's
 * generated project state.
 *
 * Construct generates data continuously: traces, intake archives, task
 * graphs, worker logs, session records, backups. None of it has a
 * natural ceiling, so left unchecked the tree grows until it threatens
 * the operator's disk. The budget primitive caps each category against
 * a config-defined ceiling.
 *
 * Two enforcement modes:
 *   - **Hard-reject** (traces, worker logs): observability is
 *     replaceable. When the cap is hit, refuse new writes with a
 *     typed error pointing at `construct prune` and the dashboard
 *     budget page. Better to lose a trace than crash the operator's
 *     machine.
 *   - **Soft-warn** (intake archive, task graphs): R&D state is
 *     load-bearing — never reject; emit a warning the operator can
 *     see in the doctor surface, and pruning gets aggressive.
 *
 * Category locations: traces and worker-logs are the two
 * hard-reject, highest-volume categories, so they resolve through the
 * machine-scoped state root (`resolveStateDir`) rather than the
 * project's own `.construct/`. The remaining soft-warn categories are smaller
 * and still project-local. "Total .construct/ cap" therefore really means
 * "total generated-state cap" and sums bytes across both locations.
 *
 * Defaults live in DEFAULT_PROJECT_CONFIG.resources. The operator
 * raises them in construct.config.json or via the dashboard. Doctor
 * surfaces usage vs cap at 80% (warn) and 100% (fail).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveStateDir } from '../state-root.mjs';
import { configPath } from '../config-dir.mjs';

export const HARD_REJECT_CATEGORIES = new Set(['traces', 'worker-logs']);
export const SOFT_WARN_CATEGORIES = new Set(['intake-archive', 'task-graphs', 'sessions', 'backups', 'handoffs']);

const STATE_ROOT_CATEGORY_SEGMENTS = {
  traces: ['traces'],
  'worker-logs': ['runtime', 'worker'],
};

const PROJECT_LOCAL_CATEGORY_PATHS = {
  'intake-archive': 'intake/processed',
  'intake-skipped': 'intake/skipped',
  'task-graphs': 'task-graphs',
  sessions: 'sessions',
  backups: 'backups',
  handoffs: 'handoffs',
};

const CATEGORY_NAMES = [...Object.keys(STATE_ROOT_CATEGORY_SEGMENTS), ...Object.keys(PROJECT_LOCAL_CATEGORY_PATHS)];

// ensureDir:false — this module only measures/prunes usage, it never itself
// writes a trace or worker-log file, so a measurement call must not conjure
// the directory it is merely checking.

function categoryDir(projectRoot, name) {
  const stateSegments = STATE_ROOT_CATEGORY_SEGMENTS[name];
  if (stateSegments) return resolveStateDir(projectRoot, ...stateSegments, { ensureDir: false });
  const rel = PROJECT_LOCAL_CATEGORY_PATHS[name];
  return rel ? configPath(projectRoot, rel) : null;
}

function loadResourceBudgets(projectRoot, env) {
  const { config } = loadProjectConfig(projectRoot, env);
  return config?.resources ?? {};
}

function walkDirSize(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const r = walkDirSize(full);
      bytes += r.bytes;
      files += r.files;
    } else {
      try {
        bytes += fs.statSync(full).size;
        files += 1;
      } catch { /* race — file disappeared */ }
    }
  }
  return { bytes, files };
}

export function measureUsage(projectRoot, env = process.env) {
  const budgets = loadResourceBudgets(projectRoot, env);
  const result = { categories: {}, totalConstructBytes: 0, totalConstructCap: (budgets?.disk?.totalConstructMaxMb ?? 2000) * 1024 * 1024 };
  for (const name of CATEGORY_NAMES) {
    const full = categoryDir(projectRoot, name);
    const { bytes, files } = walkDirSize(full);
    result.categories[name] = {
      bytes,
      files,
      path: full,
      enforcement: HARD_REJECT_CATEGORIES.has(name) ? 'hard-reject' : 'soft-warn',
    };
    result.totalConstructBytes += bytes;
  }
  result.totalConstructUsageRatio = result.totalConstructCap > 0 ? result.totalConstructBytes / result.totalConstructCap : 0;
  return result;
}

let lastBudgetWarnAt = 0;

export function warnBudgetOnce(message, env = process.env) {
  if (env.NODE_ENV === 'test' && env.CONSTRUCT_BUDGET_WARN_IN_TEST !== '1') return;
  const now = Date.now();
  if (now - lastBudgetWarnAt < 60_000) return;
  lastBudgetWarnAt = now;
  process.stderr.write(`[construct:budget] ${message}\n`);
}

export function reserveOrReject(projectRoot, category, sizeBytes, env = process.env) {
  if (!CATEGORY_NAMES.includes(category)) {
    return { ok: true, source: 'unknown-category' };
  }
  const usage = measureUsage(projectRoot, env);
  const totalAfter = usage.totalConstructBytes + sizeBytes;
  if (totalAfter > usage.totalConstructCap) {
    if (HARD_REJECT_CATEGORIES.has(category)) {
      return {
        ok: false,
        reason: 'budget-exceeded',
        message: `.construct/ total ${Math.round(totalAfter / 1024 / 1024)}MB would exceed cap ${Math.round(usage.totalConstructCap / 1024 / 1024)}MB — run \`construct prune\` or raise resources.disk.totalConstructMaxMb`,
      };
    }
    return {
      ok: true,
      warn: true,
      reason: 'budget-warning',
      message: `.construct/ usage at ${Math.round((totalAfter / usage.totalConstructCap) * 100)}% — \`construct prune\` recommended`,
    };
  }
  const ratio = totalAfter / usage.totalConstructCap;
  if (ratio > 0.8) {
    return { ok: true, warn: true, reason: 'budget-warning', message: `.construct/ usage at ${Math.round(ratio * 100)}% of cap` };
  }
  return { ok: true };
}

function listHardRejectFiles(projectRoot) {
  const files = [];
  for (const cat of HARD_REJECT_CATEGORIES) {
    const dir = categoryDir(projectRoot, cat);
    if (!dir || !fs.existsSync(dir)) continue;
    const walk = (current) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        try {
          const stat = fs.statSync(full);
          files.push({
            category: cat,
            path: full,
            mtimeMs: stat.mtimeMs,
            bytes: stat.size,
          });
        } catch { /* race */ }
      }
    };
    walk(dir);
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return files;
}

export function planEmergencyReclaim(projectRoot, bytesNeeded, env = process.env) {
  const usage = measureUsage(projectRoot, env);
  const bytesToFree = Math.max(0, usage.totalConstructBytes + bytesNeeded - usage.totalConstructCap);
  if (bytesToFree <= 0) return [];

  const actions = [];
  let freed = 0;
  for (const file of listHardRejectFiles(projectRoot)) {
    if (freed >= bytesToFree) break;
    actions.push({
      category: file.category,
      path: file.path,
      reason: 'emergency-reclaim',
      bytes: file.bytes,
    });
    freed += file.bytes;
  }
  return actions;
}

export function ensureDiskWrite(projectRoot, category, sizeBytes, env = process.env) {
  let check = reserveOrReject(projectRoot, category, sizeBytes, env);
  if (check.ok) return check;

  if (!HARD_REJECT_CATEGORIES.has(category)) {
    return check;
  }

  const actions = planEmergencyReclaim(projectRoot, sizeBytes, env);
  let reclaimed = { removed: [], bytesFreed: 0 };
  if (actions.length) {
    reclaimed = executePrune(actions);
    check = reserveOrReject(projectRoot, category, sizeBytes, env);
    if (check.ok) {
      return { ...check, reclaimed };
    }
  }

  return { ...check, reclaimed };
}

export function planPrune(projectRoot, env = process.env, opts = {}) {
  const budgets = loadResourceBudgets(projectRoot, env);
  const disk = budgets?.disk ?? {};
  const now = opts.now ?? Date.now();
  const actions = [];

  const tracesMaxDays = disk.tracesMaxDays ?? 30;
  const tracesDir = categoryDir(projectRoot, 'traces');
  if (fs.existsSync(tracesDir)) {
    const cutoff = now - tracesMaxDays * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(tracesDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(tracesDir, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        actions.push({ category: 'traces', path: full, reason: `older than ${tracesMaxDays}d`, bytes: stat.size });
      }
    }
  }

  const intakeDir = configPath(projectRoot, 'intake/processed');
  const intakeMaxItems = disk.intakeArchiveMaxItems ?? 500;
  const intakeMaxDays = disk.intakeArchiveMaxDays ?? 90;
  if (fs.existsSync(intakeDir)) {
    const cutoff = now - intakeMaxDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(intakeDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(intakeDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (i >= intakeMaxItems) {
        actions.push({ category: 'intake-archive', path: f.path, reason: `exceeds ${intakeMaxItems} items`, bytes: f.bytes });
      } else if (f.mtimeMs < cutoff) {
        actions.push({ category: 'intake-archive', path: f.path, reason: `older than ${intakeMaxDays}d`, bytes: f.bytes });
      }
    }
  }

  const graphsDir = configPath(projectRoot, 'task-graphs');
  const graphsMaxItems = disk.taskGraphsMaxItems ?? 200;
  const graphsMaxDays = disk.taskGraphsMaxDays ?? 90;
  if (fs.existsSync(graphsDir)) {
    const cutoff = now - graphsMaxDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(graphsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(graphsDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (i >= graphsMaxItems) {
        actions.push({ category: 'task-graphs', path: f.path, reason: `exceeds ${graphsMaxItems} items`, bytes: f.bytes });
      } else if (f.mtimeMs < cutoff) {
        actions.push({ category: 'task-graphs', path: f.path, reason: `older than ${graphsMaxDays}d`, bytes: f.bytes });
      }
    }
  }

  const workerDir = categoryDir(projectRoot, 'worker-logs');
  const workerMaxMb = disk.workerLogsMaxMb ?? 100;
  const workerMaxDays = disk.workerLogsMaxDays ?? 14;
  if (fs.existsSync(workerDir)) {
    const cutoff = now - workerMaxDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(workerDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const full = path.join(workerDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalBytes = 0;
    for (const f of files) {
      totalBytes += f.bytes;
      const overSize = totalBytes > workerMaxMb * 1024 * 1024;
      const overAge = f.mtimeMs < cutoff;
      if (overSize) {
        actions.push({ category: 'worker-logs', path: f.path, reason: `worker logs > ${workerMaxMb}MB cap`, bytes: f.bytes });
      } else if (overAge) {
        actions.push({ category: 'worker-logs', path: f.path, reason: `older than ${workerMaxDays}d`, bytes: f.bytes });
      }
    }
  }

  const handoffsDir = configPath(projectRoot, 'handoffs');
  const handoffsMaxItems = disk.handoffsMaxItems ?? 50;
  const handoffsMaxDays = disk.handoffsMaxDays ?? 30;
  if (fs.existsSync(handoffsDir)) {
    const cutoff = now - handoffsMaxDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(handoffsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const full = path.join(handoffsDir, f);
        const stat = fs.statSync(full);
        return { path: full, mtimeMs: stat.mtimeMs, bytes: stat.size };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (i >= handoffsMaxItems) {
        actions.push({ category: 'handoffs', path: f.path, reason: `exceeds ${handoffsMaxItems} items`, bytes: f.bytes });
      } else if (f.mtimeMs < cutoff) {
        actions.push({ category: 'handoffs', path: f.path, reason: `older than ${handoffsMaxDays}d`, bytes: f.bytes });
      }
    }
  }

  const backupsRoot = configPath(projectRoot, 'backups');
  const backupsMaxDays = disk.backupsMaxDays ?? 60;
  if (fs.existsSync(backupsRoot)) {
    const cutoff = now - backupsMaxDays * 24 * 60 * 60 * 1000;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          actions.push({ category: 'backups', path: full, reason: `older than ${backupsMaxDays}d`, bytes: stat.size });
        }
      }
    };
    walk(backupsRoot);
  }

  return actions;
}

export function executePrune(actions) {
  const removed = [];
  let bytesFreed = 0;
  for (const a of actions) {
    try {
      fs.unlinkSync(a.path);
      removed.push(a.path);
      bytesFreed += a.bytes || 0;
    } catch { /* race — already gone */ }
  }
  return { removed, bytesFreed };
}
