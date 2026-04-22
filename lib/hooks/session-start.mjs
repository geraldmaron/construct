#!/usr/bin/env node
/**
 * lib/hooks/session-start.mjs — Session start hook — emits resumable project context at the start of each session.
 *
 * Runs at session start. Reads .cx/context.json, workflow state, git status, and efficiency log to produce a structured resume message. Non-blocking — always exits 0.
 */
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadWorkflow, summarizeWorkflow, alignmentFindings } from '../workflow-state.mjs';
import { buildCompactEfficiencyDigest, readEfficiencyLog } from '../efficiency.mjs';
import { readContextState, contextSummaryLine } from '../context-state.mjs';
import { createSession, lastSession, buildResumeContext } from '../session-store.mjs';
import { listObservations } from '../observation-store.mjs';
import { loadConstructEnv } from '../env-config.mjs';

async function queryCass(port, method, params) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: method, arguments: params } }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.result?.content?.[0]?.text;
    return text || null;
  } catch {
    return null;
  }
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CONSTRUCT_BIN = resolve(MODULE_DIR, '..', '..', 'bin', 'construct');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';
const date = new Date().toISOString().slice(0, 10);

// Load context — project-local first, global fallback
const localCtx = join(cwd, '.cx', 'context.md');
const globalCtx = join(homedir(), '.cx', 'context.md');
let context = '';
const localState = readContextState(cwd);
const globalState = localState ? null : readContextState(homedir());
const stateContext = localState || globalState;
if (stateContext?.markdown) {
  const raw = String(stateContext.markdown);
  context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw;
} else if (existsSync(localCtx)) {
  try { const raw = readFileSync(localCtx, 'utf8'); context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw; } catch { /* best effort */ }
} else if (existsSync(globalCtx)) {
  try { const raw = readFileSync(globalCtx, 'utf8'); context = raw.length > 1800 ? `${raw.slice(0, 400)}\n…\n${raw.slice(-1400)}` : raw; } catch { /* best effort */ }
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
let sessionResumeNote = '';
try {
  createSession(cwd, { project: projectName, platform: 'claude-code' });
  const prev = lastSession(cwd, projectName);
  if (prev && prev.status !== 'active') {
    const resumeCtx = buildResumeContext(prev);
    if (resumeCtx) {
      sessionResumeNote = '\n## Last session context\n' + resumeCtx + '\n';
    }
  }
} catch { /* best effort — session store is non-blocking */ }

// Surface recent observations for this project (learning loop).
let observationsNote = '';
try {
  const recentObs = listObservations(cwd, { project: projectName, limit: 5 });
  if (recentObs.length > 0) {
    const items = recentObs.map((o) => '- [' + o.role + '] ' + o.summary).join('\n');
    observationsNote = '\n## Prior observations\n' + items + '\n';
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

const header = `## Resuming — ${projectName} · ${date}\nNote: You are currently working on the **${projectName}** project.`;
const footer = [statusLine, recentLine].filter(Boolean).join(' · ');

let workflowNote = '';
try {
  const workflow = loadWorkflow(cwd);
  if (workflow) {
    const findings = alignmentFindings(workflow);
    const high = findings.filter((finding) => finding.severity === 'HIGH').length;
    const medium = findings.filter((finding) => finding.severity === 'MEDIUM').length;
    workflowNote = `\n## Active Construct Workflow\n${summarizeWorkflow(workflow)}\nAlignment: ${high ? `${high} high issue${high === 1 ? '' : 's'}` : 'no high issues'}${medium ? `, ${medium} warning${medium === 1 ? '' : 's'}` : ''}\n`;
  }
} catch {
  // best effort only
}

const body = context || '## Fresh start — no prior context found.\n';
const efficiency = buildCompactEfficiencyDigest(readEfficiencyLog(homedir()));
const efficiencyNote = efficiency?.compact
  ? `\n## Session efficiency\n${efficiency.compact}\n`
  : '';
const stateNote = contextSummary ? `\n## Context digest\n${contextSummary}\n` : '';

// Query CASS memory directly — embed results rather than issuing an advisory directive.
const env = loadConstructEnv({ rootDir: resolve(MODULE_DIR, '..', '..'), homeDir: homedir(), env: process.env });
const cassPort = env.MEMORY_PORT || process.env.MEMORY_PORT || '8766';
let cassNote = '';
try {
  const [ctxResult, searchResult] = await Promise.all([
    queryCass(cassPort, 'cm_context', { task: projectName, limit: 5 }),
    queryCass(cassPort, 'memory_search', { query: projectName, limit: 5 }),
  ]);
  const parts = [];
  if (ctxResult) parts.push(ctxResult.slice(0, 800));
  if (searchResult) {
    let parsed;
    try { parsed = JSON.parse(searchResult); } catch { parsed = null; }
    const hits = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
    if (hits.length > 0) {
      const lines = hits.slice(0, 5).map((h) => '- ' + (h.summary || h.text || JSON.stringify(h)).slice(0, 120)).join('\n');
      parts.push(`**Prior context:**\n${lines}`);
    }
  }
  if (parts.length > 0) cassNote = `\n## Memory (CASS)\n${parts.join('\n\n')}\n`;
} catch { /* best effort */ }

// Project skill scope — make skills-profile.json functional even when the
// host does not support per-project plugin filtering. Tell the model
// explicitly which skills are out of scope for this project.
let skillScopeNote = '';
try {
  const profilePath = join(cwd, '.cx', 'skills-profile.json');
  if (existsSync(profilePath)) {
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const irrelevant = profile?.recommendedDisable || profile?.decision?.irrelevant || [];
    const tags = profile?.profile?.tags || [];
    if (irrelevant.length > 0) {
      const sample = irrelevant.slice(0, 20).join(', ');
      const more = irrelevant.length > 20 ? `, +${irrelevant.length - 20} more` : '';
      skillScopeNote =
        '\n## Project skill scope\n' +
        `This project's stack: ${tags.join(', ') || 'unspecified'}.\n` +
        `${irrelevant.length} installed skills are out of scope for this project and should not be invoked unless the user explicitly asks for them. ` +
        `Out of scope: ${sample}${more}.\n` +
        'Run `construct skills scope` for the full classification.\n';
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
