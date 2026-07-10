/**
 * lib/hygiene/scan.mjs — Lightweight doc hygiene candidate scanner.
 *
 * Selects up to N (default 25) documents for hygiene review each run using:
 * 1. lifecycle/approved tag + last_verified_at older than 30 days
 * 2. lifecycle/draft tag + last_verified_at older than 7 days
 * 3. Any document without a last_verified_at field
 *
 * Sorted oldest-first. Results are beads-item candidates — actual creation
 * is handled by the scheduler job handler.
 *
 * Wired into the `doc-hygiene-scan` scheduler job (lib/scheduler/index.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';

const APPROVED_STALE_DAYS = 30;
const DRAFT_STALE_DAYS = 7;
const DEFAULT_BATCH = 25;

/**
 * Read YAML frontmatter from a markdown file. Returns {} on failure.
 */
function readFrontmatter(filePath) {
  let text = '';
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return {}; }
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (kv) fm[kv[1].replace(/-/g, '_')] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

/**
 * Walk a directory and return all .md / .mdx files.
 */
function walkMarkdown(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(p, results);
    else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) results.push(p);
  }
  return results;
}

/**
 * Return the N oldest hygiene candidates from the given scopes.
 *
 * @param {object} opts
 * @param {string} opts.cwd       — project root
 * @param {string[]} [opts.scopes] — directories to scan relative to cwd
 * @param {number} [opts.limit]   — max candidates (default 25)
 * @returns {Array<{path, rel, verdict, lastVerifiedAt, ageDays, tags}>}
 */
export function findHygieneCandidates({ cwd = process.cwd(), scopes = ['docs/prd', 'docs/adr', 'docs/rfc', `${CONFIG_DIR_NAME}/knowledge`], limit = DEFAULT_BATCH } = {}) {
  const now = Date.now();
  const candidates = [];

  for (const scope of scopes) {
    const dir = path.join(cwd, scope);
    if (!fs.existsSync(dir)) continue;
    for (const filePath of walkMarkdown(dir)) {
      const fm = readFrontmatter(filePath);
      // Handle both inline YAML arrays `[a, b]` and comma-separated strings.
    const rawTags = fm.tags ? String(fm.tags).replace(/^\s*\[|\]\s*$/g, '') : '';
    const tags = rawTags ? rawTags.split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')) : [];
      const lva = fm.last_verified_at || null;
      const ageDays = lva ? Math.floor((now - new Date(lva).getTime()) / 86400000) : null;

      const lifecycle = tags.find((t) => t.startsWith('lifecycle/')) || null;

      let include = false;
      let reason = '';

      if (!lva) {
        include = true;
        reason = 'no last_verified_at';
      } else if (lifecycle === 'lifecycle/approved' && ageDays > APPROVED_STALE_DAYS) {
        include = true;
        reason = `approved and stale (${ageDays}d > ${APPROVED_STALE_DAYS}d)`;
      } else if (lifecycle === 'lifecycle/draft' && ageDays > DRAFT_STALE_DAYS) {
        include = true;
        reason = `draft and stale (${ageDays}d > ${DRAFT_STALE_DAYS}d)`;
      }

      if (include) {
        candidates.push({
          path: filePath,
          rel: path.relative(cwd, filePath),
          reason,
          lastVerifiedAt: lva,
          ageDays,
          tags,
        });
      }
    }
  }

  // Sort: no last_verified_at first (oldest-first by path), then by age descending.
  candidates.sort((a, b) => {
    if (!a.lastVerifiedAt && !b.lastVerifiedAt) return a.rel.localeCompare(b.rel);
    if (!a.lastVerifiedAt) return -1;
    if (!b.lastVerifiedAt) return 1;
    return (b.ageDays || 0) - (a.ageDays || 0);
  });

  return candidates.slice(0, limit);
}

/**
 * Stamp last_verified_at into a document's frontmatter.
 * If no frontmatter exists, prepends one.
 */
export function stampVerified(filePath, { date = new Date().toISOString().slice(0, 10) } = {}) {
  let text = '';
  try { text = fs.readFileSync(filePath, 'utf8'); } catch {
    throw new Error(`stampVerified: cannot read ${filePath}`);
  }

  const fmMatch = text.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (fmMatch) {
    const fmBody = fmMatch[2];
    if (fmBody.includes('last_verified_at:')) {
      // Update existing field.
      const updated = fmBody.replace(/^last_verified_at:.+$/m, `last_verified_at: ${date}`);
      fs.writeFileSync(filePath, `${fmMatch[1]}${updated}${fmMatch[3]}${text.slice(fmMatch[0].length)}`);
    } else {
      // Append field inside frontmatter.
      fs.writeFileSync(filePath, `${fmMatch[1]}${fmBody}\nlast_verified_at: ${date}${fmMatch[3]}${text.slice(fmMatch[0].length)}`);
    }
  } else {
    // No frontmatter — prepend one.
    fs.writeFileSync(filePath, `---\nlast_verified_at: ${date}\n---\n${text}`);
  }
}
