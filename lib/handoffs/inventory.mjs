/**
 * lib/handoffs/inventory.mjs — handoff hygiene primitives.
 *
 * Handoffs (markdown files in `.cx/handoffs/`) are written by
 * `lib/beads-automation.mjs::create-handoff` whenever a session bridges
 * to the next agent. The inventory helper surfaces:
 *
 *   - total file count + total bytes
 *   - oldest mtime (age, in days)
 *   - count of files past `handoffsMaxDays` (eligible to prune)
 *   - count of files referencing a *closed* bead (stale-but-resolved)
 *   - per-file id, status, and path (from contract parser) for CLI display
 *
 * The dashboard insights card consumes this; doctor surfaces a warning
 * when stale handoffs accumulate past the threshold.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadProjectConfig } from '../config/project-config.mjs';
import { parseHandoff } from './contract.mjs';
import { configPath } from '../config-dir.mjs';

const HANDOFFS_REL = 'handoffs';
const BEAD_REF_RE = /\bconstruct-[a-z0-9]+\b/gi;

function readFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      const content = fs.readFileSync(full, 'utf8');
      const beadRefs = Array.from(new Set((content.match(BEAD_REF_RE) || []).map((s) => s.toLowerCase())));
      const parsed = parseHandoff(content);
      const id = parsed.frontmatter?.id || f.replace(/\.md$/, '');
      return { filename: f, id, path: full, mtimeMs: stat.mtimeMs, bytes: stat.size, beadRefs, status: parsed.status };
    });
}

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

function closedBeadIds(projectRoot) {
  try {
    const r = spawnSync('bd', ['list', '--status', 'closed', '--json'], {
      cwd: bdRootCwd(projectRoot),
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 5000,
    });
    if (r.status !== 0) return new Set();
    const issues = JSON.parse(r.stdout);
    return new Set(issues.map((it) => String(it.id).toLowerCase()));
  } catch { return new Set(); }
}

export function summarizeHandoffs(projectRoot = process.cwd(), env = process.env, { now = Date.now() } = {}) {
  const dir = configPath(projectRoot, HANDOFFS_REL);
  const files = readFiles(dir);
  if (files.length === 0) {
    return {
      state: 'empty',
      total: 0,
      bytes: 0,
      oldestAgeDays: null,
      pastRetentionCount: 0,
      resolvedCount: 0,
    };
  }
  const { config } = loadProjectConfig(projectRoot, env);
  const maxDays = config?.resources?.disk?.handoffsMaxDays ?? 30;
  const maxItems = config?.resources?.disk?.handoffsMaxItems ?? 50;
  const cutoff = now - maxDays * 24 * 60 * 60 * 1000;
  const sorted = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const oldestAgeMs = now - sorted[0].mtimeMs;
  const closed = closedBeadIds(projectRoot);
  let pastRetentionCount = 0;
  let resolvedCount = 0;
  let resolvedFiles = [];
  for (const f of files) {
    if (f.mtimeMs < cutoff) pastRetentionCount += 1;
    if (f.beadRefs.length > 0 && f.beadRefs.every((id) => closed.has(id))) {
      resolvedCount += 1;
      resolvedFiles.push(f.filename);
    }
  }
  const bytes = files.reduce((s, f) => s + f.bytes, 0);
  const enriched = files.map((f) => ({
    ...f,
    ageDays: (now - f.mtimeMs) / (24 * 60 * 60 * 1000),
  }));
  return {
    state: 'ok',
    total: files.length,
    bytes,
    oldestAgeDays: oldestAgeMs / (24 * 60 * 60 * 1000),
    maxDays,
    maxItems,
    pastRetentionCount,
    resolvedCount,
    resolvedFiles: resolvedFiles.slice(0, 10),
    files: enriched,
    recent: sorted.slice(-5).reverse().map((f) => ({
      filename: f.filename,
      ageDays: (now - f.mtimeMs) / (24 * 60 * 60 * 1000),
      beadRefs: f.beadRefs,
      bytes: f.bytes,
    })),
  };
}
