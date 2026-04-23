#!/usr/bin/env node
/**
 * lib/hooks/session-start.mjs — Session start hook — emits resumable project context at the start of each session.
 *
 * Runs at session start. Reads .cx/context.json, workflow state, git status, and efficiency log to produce a structured resume message. Non-blocking — always exits 0.
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadWorkflow, alignmentFindings } from '../workflow-state.mjs';
import { buildCompactEfficiencyDigest, readEfficiencyLog } from '../efficiency.mjs';
import { readContextState, contextSummaryLine } from '../context-state.mjs';
import { createSession, lastSession, buildResumeContext } from '../session-store.mjs';
import { listObservations } from '../observation-store.mjs';
import { loadConstructEnv } from '../env-config.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = resolve(MODULE_DIR, '..', '..', 'bin', 'construct');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';
const date = new Date().toISOString().slice(0, 10);

// Tiered injection model:
//   Tier 1 — always inject (header, branch, status, current task one-liner)
//   Tier 2 — inject only when fresh and meaningful (context.md if <7d old,
//            workflow if active, skill scope, recent drops)
//   Tier 3 — surface as a one-line hint pointing at an MCP tool
//            (memory_recent, efficiency_snapshot) instead of injecting the
//            full payload every session.
const FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function fileIsFresh(path) {
  try {
    if (!existsSync(path)) return false;
    return Date.now() - statSync(path).mtimeMs < FRESHNESS_WINDOW_MS;
  } catch { return false; }
}

// Load context — project-local first, global fallback. Gate by 7-day freshness:
// stale context files inject only the digest line as fallback (Tier 2 → Tier 1
// degradation), full body only when modified within the freshness window.
const localCtx = join(cwd, '.cx', 'context.md');
const globalCtx = join(homedir(), '.cx', 'context.md');
let context = '';
let contextStale = false;
const localState = readContextState(cwd);
const globalState = localState ? null : readContextState(homedir());
const stateContext = localState || globalState;
const stateContextPath = localState ? localCtx : globalCtx;
if (stateContext?.markdown) {
  if (fileIsFresh(stateContextPath) || !existsSync(stateContextPath)) {
    const raw = String(stateContext.markdown);
    context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw;
  } else {
    contextStale = true;
  }
} else if (existsSync(localCtx) && fileIsFresh(localCtx)) {
  try { const raw = readFileSync(localCtx, 'utf8'); context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw; } catch { /* best effort */ }
} else if (existsSync(globalCtx) && fileIsFresh(globalCtx)) {
  try { const raw = readFileSync(globalCtx, 'utf8'); context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw; } catch { /* best effort */ }
} else if (existsSync(localCtx) || existsSync(globalCtx)) {
  contextStale = true;
}
const contextSummary = contextSummaryLine(stateContext);

// Git status
let uncommitted = 0;
let recentCommits = '';
try {
  const status = execSync(`git -C "${cwd}" status --short 2>/dev/null`, { timeout: 5000 }).toString();
  uncommitted = status.split('\n').filter(l => l.trim()).length;
} catch { /* not a git repo or git unavailable */ }

try {
  recentCommits = execSync(`git -C "${cwd}" log --oneline -3 2>/dev/null`, { timeout: 5000 }).toString().trim();
} catch { /* best effort */ }


// Session persistence — create session and load last for resume context.
// Cap resume note at 600 chars; the full record is available via session_load.
let sessionResumeNote = '';
try {
  createSession(cwd, { project: projectName, platform: 'claude-code' });
  const prev = lastSession(cwd, projectName);
  if (prev && prev.status !== 'active') {
    const resumeCtx = buildResumeContext(prev);
    if (resumeCtx) {
      const capped = resumeCtx.length > 600
        ? resumeCtx.slice(0, 580) + '\n…(truncated — call `session_load` for full record)'
        : resumeCtx;
      sessionResumeNote = '\n## Last session context\n' + capped + '\n';
    }
  }
} catch { /* best effort — session store is non-blocking */ }

// Tier 3 hint — surface a one-line pointer to recent observations rather
// than embedding them. Full payload is available via the `memory_recent`
// MCP tool. We pay one line of context to expose an on-demand fetch path.
let observationsNote = '';
try {
  const recentObs = listObservations(cwd, { project: projectName, limit: 5 });
  const distinct = new Set(recentObs.map((o) => `${o.role}::${o.summary}`));
  if (distinct.size >= 2) {
    observationsNote = `\n## Prior observations\n${distinct.size} prior observation${distinct.size === 1 ? '' : 's'} available — call \`memory_recent\` to fetch.\n`;
  }
} catch { /* best effort */ }

// Pending typecheck warning
const tcPath = join(homedir(), '.cx', 'pending-typecheck.txt');
let pendingNote = '';
try {
  const pending = existsSync(tcPath) ? readFileSync(tcPath, 'utf8').split('\n').filter(Boolean) : [];
  if (pending.length > 0) pendingNote = '\nNote: TypeScript was not checked last session.';
} catch { /* best effort */ }

const statusLine = uncommitted > 0
  ? `Current: ${uncommitted} uncommitted file${uncommitted !== 1 ? 's' : ''}`
  : 'Current: clean working tree';

const recentLine = recentCommits
  ? `Recent: ${recentCommits.split('\n').join(' · ')}`
  : '';

// Working branch — show prominently at session start so it is visible
// before any mutating operation is even proposed.
let workingBranch = '(unknown)';
try {
  workingBranch = execSync(`git -C "${cwd}" rev-parse --abbrev-ref HEAD 2>/dev/null`, { timeout: 5000 }).toString().trim() || '(unknown)';
} catch { /* not a git repo */ }
const header = `## Resuming — ${projectName} · ${date}
## Working branch: **${workingBranch}**
Note: You are currently working on the **${projectName}** project on branch **${workingBranch}**. Commits, pushes, and PR merges require explicit user approval via \`construct approve <action>\`.`;
const footer = [statusLine, recentLine].filter(Boolean).join(' · ');

// Tier 1 — current workflow task one-liner. Full summary deferred to the
// `workflow_status` MCP tool to keep session-start lean.
let workflowNote = '';
try {
  const workflow = loadWorkflow(cwd);
  if (workflow) {
    const tasks = Array.isArray(workflow?.tasks) ? workflow.tasks : [];
    const active = tasks.find((t) => t.status === 'in_progress')
      || tasks.find((t) => t.status === 'pending' || t.status === 'todo')
      || tasks.find((t) => t.status === 'blocked_needs_user');
    const findings = alignmentFindings(workflow);
    const high = findings.filter((finding) => finding.severity === 'HIGH').length;
    const issuesNote = high ? ` · ${high} high alignment issue${high === 1 ? '' : 's'}` : '';
    if (active) {
      const key = active.key || active.id || '';
      const title = (active.title || '').slice(0, 80);
      workflowNote = `\n## Workflow\nCurrent: ${key ? `[${key}] ` : ''}${title} (${active.status})${issuesNote}\nFull summary via \`workflow_status\` tool.\n`;
    } else if (high) {
      workflowNote = `\n## Workflow\n${high} high alignment issue${high === 1 ? '' : 's'} — call \`workflow_status\`.\n`;
    }
  }
} catch {
  // best effort only
}

const body = context || (contextStale
  ? '## Stale context — last context.md update >7 days old. Run `construct context refresh` or rely on `memory_recent`.\n'
  : '## Fresh start — no prior context found.\n');
// Tier 3 hint — efficiency snapshot is rarely needed every session. Surface
// only when the digest signals a problem (status !== 'healthy'); otherwise
// expose via the `efficiency_snapshot` MCP tool on demand.
const efficiency = buildCompactEfficiencyDigest(readEfficiencyLog(homedir()));
const efficiencyNote = (efficiency?.compact && efficiency?.status && efficiency.status !== 'healthy')
  ? `\n## Session efficiency\n${efficiency.compact}\nFull snapshot via \`efficiency_snapshot\` tool.\n`
  : '';
// Context digest is redundant when the full context.md body was already
// rendered above. Only surface the digest line as a *fallback* when no
// context body was available — it's a shorter substitute, not an addition.
const stateNote = (contextSummary && !context) ? `\n## Context digest\n${contextSummary}\n` : '';

// Tier 3 hint — CASS results are available on demand via memory_search.
// Probing CASS on every session-start adds a live network round-trip and
// can embed up to ~1 KB of results unconditionally. Surface a hint instead.
const env = loadConstructEnv({ rootDir: resolve(MODULE_DIR, '..', '..'), homeDir: homedir(), env: process.env });
const cassPort = env.MEMORY_PORT || process.env.MEMORY_PORT || '8766';
let cassNote = '';
try {
  // Only check liveness — a HEAD-like probe with a 1-second timeout.
  const probe = await fetch(`http://127.0.0.1:${cassPort}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(1000),
  });
  if (probe.ok) cassNote = `\n## CASS memory\nLive on port ${cassPort} — call \`memory_search\` with query "${projectName}" to fetch prior context.\n`;
} catch { /* not running — omit entirely */ }

// Tier 3 hint — skill scope lists can be large (20+ entries). The model
// doesn't need the full list on every session; a one-line hint is enough to
// surface that a classification exists. Full list via `construct skills scope`.
let skillScopeNote = '';
try {
  const profilePath = join(cwd, '.cx', 'skills-profile.json');
  if (existsSync(profilePath)) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const irrelevant = profile?.recommendedDisable || profile?.decision?.irrelevant || [];
    const tags = profile?.profile?.tags || [];
    if (irrelevant.length > 0) {
      skillScopeNote =
        '\n## Project skill scope\n' +
        `Stack: ${tags.join(', ') || 'unspecified'} · ${irrelevant.length} installed skill${irrelevant.length === 1 ? '' : 's'} out of scope — run \`construct skills scope\` for the full list.\n`;
    }
  }
} catch { /* best effort */ }

// Recent drop-zone files — surface very recent downloads so the user can
// ingest them with `construct drop` instead of manually referencing paths.
// Honors CONSTRUCT_DROP_DIRS; default watches Downloads/Desktop/Documents.
let dropNote = '';
try {
  const { collectCandidates } = await import('../drop.mjs');
  const { homedir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');
  const { existsSync: fsExists } = await import('node:fs');
  const watchDirs = (process.env.CONSTRUCT_DROP_DIRS
    ? process.env.CONSTRUCT_DROP_DIRS.split(':').map((s) => s.trim()).filter(Boolean)
    : [pathJoin(homedir(), 'Downloads'), pathJoin(homedir(), 'Desktop'), pathJoin(homedir(), 'Documents')]
  ).filter((d) => fsExists(d));
  const recent = collectCandidates({
    dirs: watchDirs,
    sinceMs: 60 * 60 * 1000, // 1 hour — only very recent drops
    limit: 3,
  });
  if (recent.length > 0) {
    const items = recent.map((r) => `- ${r.name} (${r.ext || 'file'}, ${Math.round((Date.now() - r.mtimeMs) / 60000)}m ago)`).join('\n');
    dropNote = '\n## Recent drop-zone files\n' +
      'Files saved in the last hour that you may want to reference:\n' +
      items + '\n' +
      'Run `construct drop` to ingest the most recent, or `construct drop --list` to see more.\n';
  }
} catch { /* best effort */ }

process.stdout.write(`${header}\n${body}${stateNote}${workflowNote}${efficiencyNote}${observationsNote}${cassNote}${skillScopeNote}${dropNote}\n${footer}${pendingNote}\n`);
process.exit(0);
