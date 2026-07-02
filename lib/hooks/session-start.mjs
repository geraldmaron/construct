#!/usr/bin/env node
/**
 * lib/hooks/session-start.mjs — Session start hook — emits resumable project context at the start of each session.
 *
 * Runs at session start. Reads .cx/context.json, git status, and efficiency log to produce a structured resume message. Non-blocking — always exits 0.
 *
 * @p95ms 300
 * @maxBlockingScope SessionStart
 *
 * @lifecycle SessionStart
 * @matcher  *
 * @exits 0 = pass
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
import { logHookFailure } from './_lib/log.mjs';
import { resolveHookOutputMode, writeHookContext } from './_lib/output-mode.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = resolve(MODULE_DIR, '..', '..', 'bin', 'construct');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'session-start', err, phase: 'parse' }); process.exit(0); }

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
const globalCtx = join(doctorRoot(), '.cx', 'context.md');
let context = '';
let contextStale = false;
const localState = readContextState(cwd);
const globalState = localState ? null : readContextState(doctorRoot());
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
  const memStatsPath = join(doctorRoot(), 'session-memory-stats.json');
  const injected = observationsNote ? (observationsNote.match(/^- /gm) || []).length : 0;
  writeFileSync(memStatsPath, JSON.stringify({
    project: projectName,
    observationsInjected: injected,
    memoryEnabled: process.env.CONSTRUCT_MEMORY !== 'off',
    at: new Date().toISOString(),
  }));
} catch { /* best effort */ }

// Pending typecheck warning
const tcPath = join(doctorRoot(), 'pending-typecheck.txt');
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
// Branch + project anchor mutating operations; the read-only/destructive
// policy lives in CLAUDE.md and the persona, so the prelude stays compact.

const header = `## Resuming — ${projectName} · ${date}
## Working branch: **${workingBranch}**`;
const footer = [statusLine, recentLine].filter(Boolean).join(' · ');

const body = context || (contextStale
  ? '## Stale context — last context.md update >7 days old. Edit .cx/context.md directly (or use the remember:context skill) to update it — the session-tracking-refresh hook refreshes it automatically on edit.\n'
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

// Single-line coordination reminder. The full rule (one writer per file,
// coordinate via tracker + plan.md) is in the persona prompt.

const concurrencyNote = '\nCoordination: one writer per file — see tracker and `plan.md` for ownership.\n';

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

// Single-line recall trigger so Construct-specific questions go through
// `knowledge_search` instead of training-data recall. Full policy in persona.

const selfKnowledgeNote = '\nSelf-knowledge: call `knowledge_search` for any Construct-specific question.\n';
const orchestrationReadinessNote = '\nOrchestration readiness: not checked for this host session — run `construct orchestrate preflight --json` or call MCP `orchestration_readiness` before relying on multi-specialist execution.\n';

// Configured provider sources hint — tell Construct what repos/projects are
// wired so it knows to call `provider_fetch` instead of saying "no context".
let sourcesNote = '';
let embedStatusNote = '';
try {
  const { loadProjectConfig } = await import('../config/project-config.mjs');
  const { resolveEffectiveSourceTargetsFromConfig } = await import('../config/source-targets.mjs');
  const { config } = loadProjectConfig(process.cwd(), process.env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, process.env);
  const repos = targets.filter((t) => t.provider === 'github').map((t) => t.selector.repo);
  const jiraTargets = targets.filter((t) => t.provider === 'jira');
  const linearTargets = targets.filter((t) => t.provider === 'linear');
  const slackTargets = targets.filter((t) => t.provider === 'slack');
  const hasSources = targets.length > 0;
  if (hasSources) {
    const parts = [];
    if (repos.length > 0) parts.push(`GitHub repos: ${repos.join(', ')}`);
    if (jiraTargets.length > 0) parts.push(`Jira projects: ${jiraTargets.map((t) => t.selector.project).join(', ')}`);
    if (linearTargets.length > 0) parts.push(`Linear teams: ${linearTargets.map((t) => t.selector.team).join(', ')}`);
    if (slackTargets.length > 0) parts.push(`Slack channels: ${slackTargets.map((t) => t.selector.channel).join(', ')}`);
    sourcesNote = '\nProvider sources wired: ' + parts.join(' · ') +
      '. Use `provider_fetch` for any question about them.\n';
  }
} catch { /* best effort */ }

try {
  const { resolveEmbedStatus, autoStartEmbedIfNeeded } = await import('../embed/cli.mjs');
  const embedStatus = resolveEmbedStatus(process.env);
  if (embedStatus.level !== 'none') {
    embedStatusNote = `\n## Embed daemon\n${embedStatus.label} · ${embedStatus.detail}\n`;
    if (embedStatus.level === 'stopped' && process.env.CX_AUTO_EMBED === '1') {
      const result = await autoStartEmbedIfNeeded(process.env);
      if (result.started) {
        embedStatusNote = `\n## Embed daemon\nembed: auto-started (pid ${result.pid}) · background polling active\n`;
      }
    }
  }
} catch { /* best effort */ }

// Role framework: drain queued events into bd issues and surface pending
// invocations. Skipped when CONSTRUCT_ROLES=off; bounded so session start
// stays fast.

let rolesNote = '';
try {
  if (process.env.CONSTRUCT_ROLES !== 'off') {
    const { processBacklog, listPending } = await import('../roles/gateway.mjs');
    await processBacklog({ sinceMs: 60 * 60 * 1000, maxProcess: 5 });
    const pendingRoles = listPending({ unresolved: true });
    if (pendingRoles.length > 0) {
      const lines = pendingRoles.slice(-5).map(
        (p) => `- ${p.cxId} · ${p.bdIssueId || '(no-bd)'} · ${p.eventType} — ${p.summary || ''}`
      );
      rolesNote = `\n## Pending role invocations (${pendingRoles.length})\n${lines.join('\n')}\nDispatch via Task: see \`construct role latest\` for the brief.\n`;
    }
  }
} catch { /* best effort */ }

// R&D intake queue + MCP broker status. Same builders feed the opencode
// plugin so both platforms surface the same prelude on session start.

let intakeReviewNote = '';
try {
  const { buildSessionPrelude } = await import('../intake/session-prelude.mjs');
  const prelude = buildSessionPrelude({ cwd, env: process.env });
  intakeReviewNote = prelude ? `\n${prelude}\n` : '';
} catch { /* best effort */ }

// Missing-env-vars notice. Reads .env.example from the project root,
// compares against .env and process.env, lists keys whose example value
// is a placeholder and whose live value is unset. Empty string when the
// project has no .env.example or all required keys are populated.

const envCheckNote = buildEnvCheckNote(cwd);

function buildEnvCheckNote(rootDir) {
  const examplePath = join(rootDir, '.env.example');
  if (!existsSync(examplePath)) return '';
  const example = parseEnvFile(examplePath);
  if (example.size === 0) return '';
  const envFile = parseEnvFile(join(rootDir, '.env'));
  const PLACEHOLDER = /^(YOUR_|<|__|\$\{|REPLACE|ADD_|INSERT_|xxx|TODO)/i;
  const missing = [];
  for (const [key, exampleVal] of example) {
    const required = !exampleVal || PLACEHOLDER.test(exampleVal);
    if (!required) continue;
    const liveFromEnvFile = envFile.has(key) && envFile.get(key) !== '' && !PLACEHOLDER.test(envFile.get(key));
    const liveFromProcessEnv = process.env[key] && !PLACEHOLDER.test(process.env[key]);
    if (!liveFromEnvFile && !liveFromProcessEnv) missing.push(key);
  }
  if (missing.length === 0) return '';
  const noun = missing.length === 1 ? 'variable' : 'variables';
  const list = missing.map((k) => `  - ${k}`).join('\n');
  return `\n## Environment check — ${missing.length} required ${noun} not set\n${list}\nAdd these to .env before running the app.\n`;
}

function parseEnvFile(p) {
  const map = new Map();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    const eq = stripped.indexOf('=');
    if (eq === -1) continue;
    const key = stripped.slice(0, eq).trim();
    const val = stripped.slice(eq + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
}

// Permission posture: surface gaps in ~/.claude/settings.json permissions.allow
// so the agent can ask the user to close them instead of stumbling into the
// classifier mid-task. Empty string when no gaps — keeps the banner small.

let permissionPostureNote = '';
try {
  const { buildPermissionPostureLine } = await import('../claude-allow.mjs');
  permissionPostureNote = buildPermissionPostureLine({ cwd });
} catch { /* best effort */ }

// SessionStart context is injected via stdout. In non-interactive / SDK runs
// that pollutes the caller's output contract, so the resolved output mode routes
// the payload to stdout (interactive), stderr, or a debug log (silent).

const payload = `${header}\n${body}${stateNote}${efficiencyNote}${observationsNote}${concurrencyNote}${skillScopeNote}${dropNote}${embedStatusNote}${sourcesNote}${selfKnowledgeNote}${orchestrationReadinessNote}${rolesNote}${intakeReviewNote}${permissionPostureNote}${envCheckNote}\n${footer}${pendingNote}\n`;
try {
  const { mode } = resolveHookOutputMode({ cwd, env: process.env });
  writeHookContext({ payload, mode });
} catch (err) {
  logHookFailure({ hook: 'session-start', err, phase: 'emit' });
  process.stdout.write(payload);
}
// Auto-bootstrap the policy-engine gate. session-start has just emitted
// branch + recent commits + prior observations + context-state — that is
// already grounding; mark the session bootstrapped so the PreToolUse rule
// stops asking for redundant ceremony before the first mutating tool call.
try {
  const sessionId = input?.session_id || input?.sessionId;
  if (sessionId) {
    const bootstrapPath = join(doctorRoot(), "bootstrap-state.json");
    let state = {};
    try { state = JSON.parse(readFileSync(bootstrapPath, "utf8")) || {}; } catch {}
    const now = Date.now();
    for (const [k, v] of Object.entries(state)) {
      if (!v?.ts || now - v.ts > 24 * 60 * 60 * 1000) delete state[k];
    }
    state[sessionId] = { ts: now, reads: 0, bootstrap: ["session-start"], done: true };
    try { writeFileSync(bootstrapPath, JSON.stringify(state)); } catch {}
  }
} catch {}

process.exit(0);
