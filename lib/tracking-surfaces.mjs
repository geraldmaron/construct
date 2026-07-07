/**
 * lib/tracking-surfaces.mjs — automated maintenance for project-tracking files.
 *
 * Owns WHAT to refresh; the hooks that call these functions own WHEN. Three
 * surfaces are covered:
 *
 *   - `.construct/context.md` + `.construct/context.json` — project state. Refreshed from
 *     recent observations, commits, and bead state at the end of each
 *     session via `refreshContextMd()`.
 *   - `plan.md` — local working plan. Bead-status table synced via
 *     `syncPlanFile()` (thin wrapper around `syncPlanWithBeads` in
 *     lib/beads-automation.mjs). When every referenced bead is closed,
 *     `archivePlanIfLanded()` stamps a landed footer, copies the plan into
 *     `.construct/handoffs/`, and resets `plan.md` to the standard template.
 *   - Beads — `closeBeadsFromPrRefs()` parses a merged PR's body for
 *     `Refs:` / `Closes:` / `Fixes:` lines and closes the named beads with
 *     a "Merged via PR #N (sha)" reason.
 *
 * Every export is best-effort: caught failures degrade to a structured
 * result object, never throw. Caller hooks log to stderr via logHookFailure
 * if they care about the failure mode.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configPath } from './config-dir.mjs';

import { extractBeadsFromPlan, syncPlanWithBeads } from './beads-automation.mjs';
import { assertBeadId } from './beads-client.mjs';
import { buildPlanTemplate } from './project-init-shared.mjs';

const CONTEXT_RECENT_DAYS = 30;
const CONTEXT_MAX_ITEMS_PER_SECTION = 10;

const SECTION_HEADERS = {
  activeWork: '## Active Work',
  recentDecisions: '## Recent Decisions',
  architectureNotes: '## Architecture Notes',
  openQuestions: '## Open Questions',
};

// ---------------------------------------------------------------------------
// context.md / context.json refresh
// ---------------------------------------------------------------------------

/**
 * Pull recent activity from observations, git, and beads into the managed
 * sections of `.construct/context.md`. Preserves any non-managed sections the user
 * has authored. Stamps `.construct/context.json` with the refresh timestamp and
 * derived counts so a session-start digest can tell when content is fresh.
 */
export async function refreshContextMd({ rootDir, now = new Date() } = {}) {
  if (!rootDir) return { ok: false, reason: 'rootDir-required' };
  const contextMdPath = configPath(rootDir, 'context.md');
  const contextJsonPath = configPath(rootDir, 'context.json');
  if (!existsSync(contextMdPath)) return { ok: false, reason: 'no-context-md' };

  const cutoff = new Date(now.getTime() - CONTEXT_RECENT_DAYS * 24 * 60 * 60 * 1000);
  const observations = collectRecentObservations(rootDir, cutoff);
  const commits = collectRecentCommits(rootDir, cutoff);
  const closedBeads = collectRecentlyClosedBeads(rootDir, cutoff);
  const openBeads = collectInProgressBeads(rootDir);

  const sections = {
    activeWork: formatActiveWork(openBeads),
    recentDecisions: formatRecentDecisions(observations, commits, closedBeads),
    architectureNotes: formatArchitectureNotes(observations),
  };

  const before = readFileSync(contextMdPath, 'utf8');
  const after = rewriteManagedSections(before, sections);
  if (after !== before) {
    writeFileSync(contextMdPath, after, 'utf8');
  }

  const json = readJsonSafe(contextJsonPath) ?? { format: 'json', source: 'construct' };
  json.lastRefreshAt = now.toISOString();
  json.activeWork = openBeads.map((b) => ({ id: b.id, title: b.title, status: b.status }));
  json.recentDecisions = closedBeads.slice(0, CONTEXT_MAX_ITEMS_PER_SECTION).map((b) => ({
    id: b.id,
    title: b.title,
    closedAt: b.closed || b.updated || b.updatedAt,
  }));
  json.architectureNotes = observations
    .filter((o) => o.category === 'architecture' || o.category === 'decision')
    .slice(0, CONTEXT_MAX_ITEMS_PER_SECTION)
    .map((o) => ({ summary: o.summary, ts: o.ts }));
  writeFileSync(contextJsonPath, JSON.stringify(json, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    changed: after !== before,
    counts: {
      activeWork: openBeads.length,
      recentDecisions: closedBeads.length,
      observations: observations.length,
      commits: commits.length,
    },
  };
}

const CONTEXT_SCAFFOLD = `# context

${SECTION_HEADERS.activeWork}

_None in progress._

${SECTION_HEADERS.recentDecisions}

_No recent decisions captured._

${SECTION_HEADERS.architectureNotes}

_No new architecture notes._

${SECTION_HEADERS.openQuestions}

_None._
`;

/**
 * Re-converge `.construct/context.md` to the canonical scaffold, then refresh the managed sections.
 * Discards user-authored drift, so the operation is gated on explicit consent (decision
 * construct-rr63.3.1): without consent the file is preserved untouched; with consent the file is
 * rewritten to the scaffold and the managed sections are repopulated from current activity. The
 * default preserves — re-converge never happens silently.
 */
export async function reconvergeContextMd({ rootDir, consent = false, now = new Date() } = {}) {
  if (!rootDir) return { ok: false, reason: 'rootDir-required' };
  const contextMdPath = configPath(rootDir, 'context.md');
  if (!existsSync(contextMdPath)) return { ok: false, reason: 'no-context-md' };
  if (!consent) return { ok: false, reason: 'consent-required', preserved: true };
  writeFileSync(contextMdPath, CONTEXT_SCAFFOLD, 'utf8');
  const refreshed = await refreshContextMd({ rootDir, now });
  return { ok: true, reconverged: true, refreshed: refreshed.ok };
}

// ---------------------------------------------------------------------------
// plan.md sync and archive
// ---------------------------------------------------------------------------

/**
 * Run the existing plan↔beads sync. Wrapper so the Stop hook calls one
 * stable name even if the underlying implementation changes later.
 */
export async function syncPlanFile({ rootDir }) {
  if (!rootDir) return { ok: false, reason: 'rootDir-required' };
  try {
    const changed = await syncPlanWithBeads({ cwd: rootDir });
    return { ok: true, changed };
  } catch (err) {
    return { ok: false, reason: 'sync-threw', error: err?.message };
  }
}

/**
 * When every bead referenced in `plan.md` is closed AND the plan has not
 * been touched in the last hour, stamp a "Landed" footer, copy the plan to
 * `.construct/handoffs/<date>-plan-landed.md`, and reset `plan.md` to the template.
 * Otherwise no-op.
 */
export async function archivePlanIfLanded({ rootDir, now = new Date() } = {}) {
  if (!rootDir) return { ok: false, reason: 'rootDir-required' };
  const planPath = join(rootDir, 'plan.md');
  if (!existsSync(planPath)) return { ok: false, reason: 'no-plan' };

  let stat;
  try { stat = statSync(planPath); }
  catch { return { ok: false, reason: 'stat-failed' }; }
  const ONE_HOUR_MS = 60 * 60 * 1000;
  if (now.getTime() - stat.mtimeMs < ONE_HOUR_MS) {
    return { ok: false, reason: 'plan-recently-touched' };
  }

  const content = readFileSync(planPath, 'utf8');
  const beadRefs = extractBeadsFromPlan(content);
  if (beadRefs.length === 0) return { ok: false, reason: 'no-bead-refs' };

  const uniqueIds = [...new Set(beadRefs.map((b) => b.beadId))];
  const statuses = uniqueIds.map((id) => readBeadStatus(rootDir, id));
  if (statuses.some((s) => s !== 'closed')) {
    return { ok: false, reason: 'beads-still-open' };
  }

  const handoffsDir = configPath(rootDir, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const archivePath = join(handoffsDir, `${date}-plan-landed.md`);
  const archiveBody = `# Landed plan — ${date}\n\nBeads closed: ${uniqueIds.join(', ')}\n\nArchived from \`plan.md\` on ${now.toISOString()} by the session-tracking-refresh hook.\n\n---\n\n${content}`;
  writeFileSync(archivePath, archiveBody, 'utf8');

  writeFileSync(planPath, buildPlanTemplate(), 'utf8');

  return { ok: true, changed: true, archivePath, beadsClosed: uniqueIds };
}

// ---------------------------------------------------------------------------
// Bead closure from merged PR
// ---------------------------------------------------------------------------

const PR_REFS_PATTERN = /(?:Refs|Closes?|Fixes?|Resolves?)\s*:?\s*(?:#?\d+|(?:construct-[a-z0-9]+(?:\s*,\s*construct-[a-z0-9]+)*))/gi;
const BEAD_ID_PATTERN = /construct-[a-z0-9]+/g;

/**
 * Parse a merged PR's body for bead references and close each open one.
 * Idempotent: skips beads already closed. Best-effort: each `bd close`
 * failure is captured in the result, no throws.
 *
 * @returns {Promise<{ ok: boolean, closed: string[], skipped: string[], errors: object[] }>}
 */
export async function closeBeadsFromPrRefs({ prNumber, mergeCommitSha = '', cwd = process.cwd() } = {}) {
  if (!prNumber) return { ok: false, reason: 'pr-number-required', closed: [], skipped: [], errors: [] };

  const body = readPrBody(prNumber, cwd);
  if (!body) return { ok: false, reason: 'pr-body-unavailable', closed: [], skipped: [], errors: [] };

  const beadIds = new Set();
  for (const match of body.match(PR_REFS_PATTERN) ?? []) {
    for (const id of match.match(BEAD_ID_PATTERN) ?? []) beadIds.add(id);
  }
  if (beadIds.size === 0) return { ok: true, closed: [], skipped: [], errors: [] };

  const closed = [];
  const skipped = [];
  const errors = [];
  const reason = mergeCommitSha
    ? `Merged via PR #${prNumber} (${mergeCommitSha.slice(0, 12)})`
    : `Merged via PR #${prNumber}`;

  for (const id of beadIds) {
    try { assertBeadId(id); } catch (err) { errors.push({ id, reason: 'invalid-bead-id', detail: err.message }); continue; }
    const status = readBeadStatus(cwd, id);
    if (status === 'closed') { skipped.push(id); continue; }
    if (status === null) { errors.push({ id, reason: 'bd-show-failed' }); continue; }
    try {
      const result = spawnSync('bd', ['close', id, '--reason', reason], { cwd, encoding: 'utf8', timeout: 5000 });
      if (result.status === 0) closed.push(id);
      else errors.push({ id, reason: 'bd-close-failed', detail: (result.stderr || '').slice(0, 200) });
    } catch (err) {
      errors.push({ id, reason: 'bd-close-threw', detail: err?.message });
    }
  }

  return { ok: true, closed, skipped, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectRecentObservations(rootDir, cutoff) {
  const dir = configPath(rootDir, 'observations');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const subdir = join(dir, entry.name);
      for (const file of safeReaddir(subdir)) {
        const obs = readJsonSafe(join(subdir, file));
        if (!obs) continue;
        const ts = obs.timestamp || obs.ts;
        if (!ts || new Date(ts) < cutoff) continue;
        out.push({ ...obs, ts });
      }
    } else if (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) {
      const obs = readJsonSafe(join(dir, entry.name));
      if (!obs) continue;
      const ts = obs.timestamp || obs.ts;
      if (!ts || new Date(ts) < cutoff) continue;
      out.push({ ...obs, ts });
    }
  }
  out.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return out;
}

function collectRecentCommits(rootDir, cutoff) {
  try {
    const result = spawnSync('git', ['log', '--since', cutoff.toISOString(), '--pretty=format:%H|%s|%cI'], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status !== 0) return [];
    return result.stdout.split('\n').filter(Boolean).map((line) => {
      const [sha, subject, committerDate] = line.split('|');
      return { sha, subject, committerDate };
    });
  } catch {
    return [];
  }
}

function collectRecentlyClosedBeads(rootDir, cutoff) {
  const beads = runBdListJson(rootDir, ['list', '--status', 'closed', '--json']);
  return beads
    .filter((b) => {
      const ts = b.closed || b.updated || b.updatedAt;
      return ts && new Date(ts) >= cutoff;
    })
    .sort((a, b) => new Date(b.closed || b.updated || b.updatedAt) - new Date(a.closed || a.updated || a.updatedAt));
}

function collectInProgressBeads(rootDir) {
  return runBdListJson(rootDir, ['list', '--status', 'in_progress', '--json']);
}

function runBdListJson(rootDir, args) {
  try {
    const result = spawnSync('bd', args, { cwd: rootDir, encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) return [];
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.issues)) return parsed.issues;
    return [];
  } catch {
    return [];
  }
}

function readBeadStatus(cwd, id) {
  try {
    const result = spawnSync('bd', ['show', id, '--json'], { cwd, encoding: 'utf8', timeout: 3000 });
    if (result.status !== 0) return null;
    const parsed = JSON.parse(result.stdout);
    return parsed?.status || null;
  } catch {
    return null;
  }
}

function readPrBody(prNumber, cwd) {
  try {
    const result = spawnSync('gh', ['pr', 'view', String(prNumber), '--json', 'body'], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.status !== 0) return null;
    const parsed = JSON.parse(result.stdout);
    return parsed?.body || null;
  } catch {
    return null;
  }
}

function safeReaddir(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function formatActiveWork(openBeads) {
  if (openBeads.length === 0) return '_None in progress._';
  return openBeads
    .slice(0, CONTEXT_MAX_ITEMS_PER_SECTION)
    .map((b) => `- **${b.id}** · ${b.title}`)
    .join('\n');
}

function formatRecentDecisions(observations, commits, closedBeads) {
  const items = [];
  for (const bead of closedBeads.slice(0, CONTEXT_MAX_ITEMS_PER_SECTION)) {
    items.push(`- closed **${bead.id}** · ${bead.title}`);
  }
  for (const commit of commits.slice(0, CONTEXT_MAX_ITEMS_PER_SECTION)) {
    items.push(`- commit \`${commit.sha.slice(0, 10)}\` — ${commit.subject}`);
  }
  for (const obs of observations.filter((o) => o.category === 'decision').slice(0, CONTEXT_MAX_ITEMS_PER_SECTION)) {
    items.push(`- decision — ${obs.summary}`);
  }
  if (items.length === 0) return '_No recent decisions captured._';
  return items.slice(0, CONTEXT_MAX_ITEMS_PER_SECTION * 2).join('\n');
}

function formatArchitectureNotes(observations) {
  const arch = observations
    .filter((o) => o.category === 'architecture' || /architect|contract|boundary|invariant/i.test(o.summary || ''))
    .slice(0, CONTEXT_MAX_ITEMS_PER_SECTION);
  if (arch.length === 0) return '_No new architecture notes._';
  return arch.map((o) => `- ${o.summary}`).join('\n');
}

function rewriteManagedSections(content, sections) {
  let out = content;
  for (const [key, header] of Object.entries(SECTION_HEADERS)) {
    if (!(key in sections)) continue;
    const body = sections[key];
    out = replaceSection(out, header, body);
  }
  return out;
}

function replaceSection(content, header, body) {
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === header);
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ') && lines[i].trim() !== header) {
      endIdx = i;
      break;
    }
  }
  const before = lines.slice(0, startIdx + 1);
  const after = lines.slice(endIdx);
  return [...before, '', body, '', ...after].join('\n');
}
