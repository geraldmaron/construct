/**
 * lib/handoffs/cleanup.mjs — automatic handoff hygiene.
 *
 * Lifecycle:
 *   1. Open handoffs (referenced beads not all closed) stay where they are.
 *   2. Resolved handoffs (referenced beads all closed) older than
 *      `handoffsMaxDays` get MOVED to `.cx/handoffs/archive/`.
 *   3. Archived handoffs older than `2 * handoffsMaxDays` get DELETED.
 *   4. Any open handoff past `handoffsMaxItems` (FIFO by mtime) is
 *      surfaced as a warning but never deleted — open work is sacred.
 *
 * The function is idempotent and runs from:
 *   - `construct down` (best effort, time-boxed)
 *   - doctor daemon tick (lib/doctor/watchers/handoffs.mjs)
 *   - `construct handoffs prune` (manual)
 *
 * Planning never recurses into archive/. The archive deletion threshold
 * compares against archive-dir mtimes, reset on move.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProjectConfig } from '../config/project-config.mjs';
import { parseHandoffFile } from './contract.mjs';

const HANDOFFS_DIR = '.cx/handoffs';
const ARCHIVE_DIR = '.cx/handoffs/archive';

function bdRootCwd(projectRoot) {
  try {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8' });
    if (r.status !== 0) return projectRoot;
    const trimmed = r.stdout.trim();
    const resolved = trimmed.startsWith('/') ? trimmed : path.join(projectRoot, trimmed);
    const candidate = path.dirname(resolved);
    if (fs.existsSync(path.join(candidate, '.beads'))) return candidate;
  } catch { /* fall through */ }
  return projectRoot;
}

function loadClosedBeadIds(projectRoot) {
  try {
    const r = spawnSync('bd', ['list', '--status', 'closed', '--json'], {
      cwd: bdRootCwd(projectRoot),
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 5000,
    });
    if (r.status !== 0) return new Set();
    const issues = JSON.parse(r.stdout || '[]');
    return new Set(issues.map((it) => String(it.id).toLowerCase()));
  } catch { return new Set(); }
}

function listHandoffFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { filename: f, path: full, mtimeMs: stat.mtimeMs, bytes: stat.size };
    });
}

function getRefBeads(filePath) {
  try {
    const parsed = parseHandoffFile(filePath);
    if (Array.isArray(parsed.frontmatter?.beads) && parsed.frontmatter.beads.length > 0) {
      return parsed.frontmatter.beads.map((s) => String(s).toLowerCase());
    }
    // Legacy fallback: scrape `construct-xxx` references from the body.
    const text = parsed.body || '';
    const matches = text.match(/\bconstruct-[a-z0-9]+\b/gi) || [];
    return Array.from(new Set(matches.map((s) => s.toLowerCase())));
  } catch {
    return [];
  }
}

export function planHandoffCleanup(projectRoot = process.cwd(), env = process.env, { now = Date.now() } = {}) {
  const { config } = loadProjectConfig(projectRoot, env);
  const disk = config?.resources?.disk || {};
  const maxDays = disk.handoffsMaxDays ?? 30;
  const maxItems = disk.handoffsMaxItems ?? 50;

  const liveDir = path.join(projectRoot, HANDOFFS_DIR);
  const archiveDir = path.join(projectRoot, ARCHIVE_DIR);
  const liveFiles = listHandoffFiles(liveDir);
  const archiveFiles = listHandoffFiles(archiveDir);

  const archiveCutoff = now - maxDays * 24 * 60 * 60 * 1000;
  const deleteCutoff = now - 2 * maxDays * 24 * 60 * 60 * 1000;

  const closed = loadClosedBeadIds(projectRoot);
  const actions = [];
  const warnings = [];

  for (const f of liveFiles) {
    const beads = getRefBeads(f.path);
    const allClosed = beads.length > 0 && beads.every((id) => closed.has(id));
    if (allClosed && f.mtimeMs < archiveCutoff) {
      actions.push({
        kind: 'archive',
        from: f.path,
        to: path.join(archiveDir, f.filename),
        reason: `referenced beads (${beads.join(', ')}) are closed and file is older than ${maxDays}d`,
        bytes: f.bytes,
      });
    }
  }

  for (const f of archiveFiles) {
    if (f.mtimeMs < deleteCutoff) {
      actions.push({
        kind: 'delete',
        path: f.path,
        reason: `archived handoff older than ${2 * maxDays}d`,
        bytes: f.bytes,
      });
    }
  }

  // Soft warning when too many live handoffs accumulate. Never delete
  // live handoffs automatically — they may reference open work.
  if (liveFiles.length > maxItems) {
    warnings.push(`${liveFiles.length} live handoffs exceeds maxItems=${maxItems}. Close or archive resolved beads to bring it down.`);
  }

  return { actions, warnings, maxDays, maxItems, archiveCutoff, deleteCutoff };
}

export function executeHandoffCleanup(plan) {
  const moved = [];
  const deleted = [];
  for (const a of plan.actions) {
    try {
      if (a.kind === 'archive') {
        fs.mkdirSync(path.dirname(a.to), { recursive: true });
        fs.renameSync(a.from, a.to);
        moved.push(a);
      } else if (a.kind === 'delete') {
        fs.unlinkSync(a.path);
        deleted.push(a);
      }
    } catch (err) {
      a.error = err.message;
    }
  }
  return { moved, deleted, warnings: plan.warnings };
}

export function autoCleanHandoffs(projectRoot = process.cwd(), env = process.env) {
  const plan = planHandoffCleanup(projectRoot, env);
  if (plan.actions.length === 0) return { plan, result: { moved: [], deleted: [], warnings: plan.warnings } };
  const result = executeHandoffCleanup(plan);
  return { plan, result };
}
