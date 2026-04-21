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
const sessionNote = sessionResumeNote;
const memoryDirective = `\n## Required first actions\nBefore responding: call memory_search("${projectName}") to retrieve prior session context and user preferences. Apply any relevant results immediately. If context is degraded, compact before broad rereads.\n`;
process.stdout.write(`${header}\n${body}${stateNote}${workflowNote}${efficiencyNote}${memoryDirective}\n${footer}${pendingNote}\n`);
process.exit(0);
