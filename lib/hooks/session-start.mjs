#!/usr/bin/env node
/**
 * lib/hooks/session-start.mjs — Session start hook — emits resumable project context at the start of each session.
 *
 * Runs at session start. Reads .cx/context.json, git status, and efficiency log to produce a structured resume message. Non-blocking — always exits 0.
 *
 * @p95ms 300
 * @maxBlockingScope SessionStart
 */
import { readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadConstructEnv } from '../env-config.mjs';
import { buildCompactEfficiencyDigest, readEfficiencyLog } from '../efficiency.mjs';
import { readContextState, contextSummaryLine } from '../context-state.mjs';
import { createSession, lastSession, buildResumeContext } from '../session-store.mjs';
import { listObservations, searchObservations } from '../observation-store.mjs';
import { countEntities } from '../entity-store.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = resolve(MODULE_DIR, '..', '..', 'bin', 'construct');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

// Merge config.env into process.env so provider source hints and embed status
// reflect the operator's actual configuration, not just the shell environment.
try {
  const merged = loadConstructEnv({ warn: false });
  for (const [k, v] of Object.entries(merged)) {
    if (!(k in process.env)) process.env[k] = v;
  }
} catch { /* best effort — non-blocking */ }

const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';
const date = new Date().toISOString().slice(0, 10);

// Tiered injection model:
//   Tier 1 — always inject (header, branch, status)
//   Tier 2 — inject only when fresh and meaningful (context.md if <7d old,
//            skill scope, recent drops)
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

// Tier 2 — inject top observations that are relevant to the current project.
// Filter out trivial placeholder summaries. Show at most 2 inline; rest are
// available on demand via memory_search / memory_recent.
// Skipped when CONSTRUCT_MEMORY=off (enables A/B comparison with memory disabled).
let observationsNote = '';
try {
  if (process.env.CONSTRUCT_MEMORY !== 'off') {
  const PLACEHOLDER_RE = /^(implement|done|completed|session completed|in_progress)[\s:.]*(done|ok|completed)?$/i;
  const searched = searchObservations(cwd, projectName, { project: projectName, limit: 10 });
  const allObs = searched.length > 0 ? searched : listObservations(cwd, { project: projectName, limit: 20 });
  const meaningful = allObs.filter((o) =>
    o.summary && o.summary.length > 10 && !PLACEHOLDER_RE.test(o.summary.trim())
  );
  const entityCount = countEntities(cwd, { project: projectName });

  if (meaningful.length > 0) {
    const top2 = meaningful.slice(0, 2).map((o) => `- [${o.category}] ${o.summary}`).join('\n');
    const rest = meaningful.length > 2
      ? ` · ${meaningful.length - 2} more via \`memory_search\``
      : '';
    const entitySuffix = entityCount > 0 ? ` · ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'} tracked` : '';
    observationsNote = `\n## Prior observations\n${top2}\n${meaningful.length} total${rest}${entitySuffix}\n`;
  } else {
    const total = allObs.length;
    if (total > 0) {
      const entitySuffix = entityCount > 0 ? ` · ${entityCount} entit${entityCount === 1 ? 'y' : 'ies'} tracked` : '';
      observationsNote = `\n## Prior observations\n${total} observation${total === 1 ? '' : 's'} available — \`memory_recent\` for recency order · \`memory_search\` for semantic lookup${entitySuffix}.\n`;
    }
  }
  } // end CONSTRUCT_MEMORY check
} catch { /* best effort */ }

// Record memory injection stats for the Stop hook to persist into .cx/memory-stats.jsonl.
try {
  const memStatsPath = join(homedir(), '.cx', 'session-memory-stats.json');
  const injected = observationsNote ? (observationsNote.match(/^- /gm) || []).length : 0;
  writeFileSync(memStatsPath, JSON.stringify({
    project: projectName,
    observationsInjected: injected,
    memoryEnabled: process.env.CONSTRUCT_MEMORY !== 'off',
    at: new Date().toISOString(),
  }));
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
Note: You are working on **${projectName}** on branch **${workingBranch}**. Read-only tool calls (knowledge_search, provider_fetch, memory_search, etc.) require no approval — call them immediately. Only destructive actions (git commits, pushes, PR merges, file deletes) require explicit user approval.`;
const footer = [statusLine, recentLine].filter(Boolean).join(' · ');

const body = context || (contextStale
  ? '## Stale context — last context.md update >7 days old. Run `construct context refresh` or rely on `memory_recent`.\n'
  : '## Fresh start — no prior context found.\n');
// Tier 3 hint — efficiency snapshot fires only when status is 'degraded'
// (repeated-read ratio or byte threshold exceeded). 'configured' (large reads
// but within budget) is advisory and not worth a session-start interrupt.
const efficiency = buildCompactEfficiencyDigest(readEfficiencyLog(homedir()));
const efficiencyNote = (efficiency?.compact && efficiency?.status === 'degraded')
  ? `\n## Session efficiency\n${efficiency.compact}\nFull snapshot via \`efficiency_snapshot\` tool.\n`
  : '';
// Context digest is redundant when the full context.md body was already
// rendered above. Only surface the digest line as a *fallback* when no
// context body was available — it's a shorter substitute, not an addition.
const stateNote = (contextSummary && !context) ? `\n## Context digest\n${contextSummary}\n` : '';

const concurrencyNote = '\n## Coordination\nDefault concurrency rule: one writer per file. If parallel agent or harness sessions are active, coordinate ownership in the tracker and `plan.md`.\n';

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

// Self-knowledge hint — always injected so the model knows to call
// `knowledge_search` for any question about Construct itself rather than
// answering from stale training data or saying "I don't know".
const selfKnowledgeNote = '\n## Self-knowledge\nFor questions about what Construct itself is, how it works, what commands exist, or how to configure or extend it — call `knowledge_search` immediately without asking for permission. Do NOT answer Construct questions from training-data recall.\n';

// Configured provider sources hint — tell Construct what repos/projects are
// wired so it knows to call `provider_fetch` instead of saying "no context".
let sourcesNote = '';
let embedStatusNote = '';
try {
  const repos = (process.env.GITHUB_REPOS ?? '').split(',').map(r => r.trim()).filter(Boolean);
  const jiraConfigured = !!(process.env.JIRA_BASE_URL);
  const linearConfigured = !!(process.env.LINEAR_API_KEY);
  const hasSources = repos.length > 0 || jiraConfigured || linearConfigured;
  if (hasSources) {
    const parts = [];
    if (repos.length > 0) parts.push(`GitHub repos: ${repos.join(', ')}`);
    if (jiraConfigured) parts.push(`Jira: ${process.env.JIRA_BASE_URL}`);
    if (linearConfigured) parts.push('Linear: configured');
    sourcesNote = '\n## Configured provider sources\n' +
      parts.join(' · ') + '\n' +
      'When the user asks anything about any of these repos or projects — "what is X", "tell me about X", "X status", "X issues", "who works on X" — call `provider_fetch` immediately as your first action. Do NOT ask for permission. Do NOT say you have no context. Do NOT answer from memory. Call the tool first, then answer from what it returns.\n';
  }

  // Embed daemon status — surface as a one-liner so operator always knows state
  const { resolveEmbedStatus, autoStartEmbedIfNeeded } = await import('../embed/cli.mjs');
  const embedStatus = resolveEmbedStatus(process.env);
  if (embedStatus.level !== 'none') {
    embedStatusNote = `\n## Embed daemon\n${embedStatus.label} · ${embedStatus.detail}\n`;
    // Auto-start if CX_AUTO_EMBED=1 and daemon is stopped
    if (embedStatus.level === 'stopped' && process.env.CX_AUTO_EMBED === '1') {
      const result = await autoStartEmbedIfNeeded(process.env);
      if (result.started) {
        embedStatusNote = `\n## Embed daemon\nembed: auto-started (pid ${result.pid}) · background polling active\n`;
      }
    }
  }
} catch { /* best effort */ }

process.stdout.write(`${header}\n${body}${stateNote}${efficiencyNote}${observationsNote}${concurrencyNote}${skillScopeNote}${dropNote}${embedStatusNote}${sourcesNote}${selfKnowledgeNote}\n${footer}${pendingNote}\n`);
process.exit(0);
