#!/usr/bin/env node
/**
 * lib/hooks/orchestration-dispatch-guard.mjs — backstop against solo-authoring an orchestrated deliverable.
 *
 * The orchestration_policy tool classifies a request into immediate / focused /
 * orchestrated. An orchestrated verdict means the orchestrator must dispatch the
 * specialist chain (cx-architect, cx-security, cx-reviewer, …) before
 * authoring the deliverable — not write it solo. The persona instructs this, but
 * instruction is not enforcement: this hook is the Claude-only barrier.
 *
 * Three roles, one file, branched on event + tool:
 *  - PostToolUse on *orchestration_policy: record the verdict. orchestrated →
 *    {pending:true,dispatched:false}; immediate/focused → cleared. Each new
 *    classification resets state for the new request.
 *  - PostToolUse on a dispatch tool (*orchestration_run, *worker_run, Task) →
 *    {dispatched:true}: the chain is running, authoring is now legitimate.
 *  - PreToolUse on Write|Edit|MultiEdit → block (exit 2) when a substantial
 *    documentation/strategy deliverable is authored while pending && !dispatched.
 *
 * Scoped to documentation/strategy artifacts (.md outside the routine planning
 * and tracking files), not code — solo code authoring is harder to separate
 * from legitimate pre-dispatch scaffolding, so it is left to the persona
 * contract rather than over-blocked here. Only the deterministic
 * orchestrated-but-not-dispatched case blocks. Fails open on any internal error.
 *
 * @p95ms 8
 * @maxBlockingScope orchestrated deliverable authoring without prior dispatch
 *
 * @lifecycle PreToolUse, PostToolUse
 * @matcher Write|Edit|MultiEdit, mcp__.*__orchestration_policy, mcp__.*__orchestration_run, mcp__.*__worker_run, Task
 * @exits 0 = pass · 2 = block (author after dispatch instead)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, relative, isAbsolute } from 'path';

const STALE_MS = 2 * 60 * 60 * 1000;
const SUBSTANTIAL_CHARS = 1500;
const SUBSTANTIAL_LINES = 40;

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const event = input?.hook_event_name || '';
const toolName = input?.tool_name || '';
const cwd = input?.cwd || process.cwd();

function statePath(root) {
  return join(root, '.cx', 'runtime', 'orchestration-guard.json');
}

function readState(root) {
  try { return JSON.parse(readFileSync(statePath(root), 'utf8')); } catch { return null; }
}

function writeState(root, state) {
  try {
    mkdirSync(join(root, '.cx', 'runtime'), { recursive: true });
    writeFileSync(statePath(root), JSON.stringify(state));
  } catch { /* fail open */ }
}

// The marker only lives inside an already-initialized construct project; never
// seed .cx into a project that does not have it.

function hasCx(root) {
  return existsSync(join(root, '.cx'));
}

function isPolicyTool(name) {
  return /orchestration_policy$/.test(name);
}

function isDispatchTool(name) {
  return name === 'Task' || /orchestration_run$/.test(name) || /worker_run$/.test(name);
}

// PostToolUse: a classification verdict updates the marker. orchestrated arms
// the guard; immediate/focused disarms it. The verdict text can be nested in an
// MCP content envelope, so match against the stringified response.

if (event === 'PostToolUse' && isPolicyTool(toolName)) {
  if (!hasCx(cwd)) process.exit(0);
  const blob = JSON.stringify(input?.tool_response ?? '').replace(/\\/g, '');
  const orchestrated = /"track"\s*:\s*"orchestrated"/.test(blob);
  if (orchestrated) writeState(cwd, { pending: true, dispatched: false, ts: Date.now() });
  else writeState(cwd, { pending: false, ts: Date.now() });
  process.exit(0);
}

// A dispatch tool arms `dispatched:true` unless its own response proves the
// dispatch produced nothing to synthesize (degraded run, zero tasks, or an
// error/failed status). Task dispatches carry no envelope — an empty/absent
// blob matches none of these markers, so they still clear the guard.

if (event === 'PostToolUse' && isDispatchTool(toolName)) {
  if (!hasCx(cwd)) process.exit(0);
  const state = readState(cwd);
  if (state?.pending) {
    const blob = JSON.stringify(input?.tool_response ?? '').replace(/\\/g, '');
    const failed = /"degraded"\s*:\s*true/.test(blob)
      || /"tasks"\s*:\s*\[\s*\]/.test(blob)
      || /"status"\s*:\s*"(error|failed)"/.test(blob);
    if (!failed) writeState(cwd, { ...state, dispatched: true });
  }
  process.exit(0);
}

// PreToolUse on an authoring tool: block only the deterministic failure — a
// substantial documentation/strategy deliverable authored while a fresh
// orchestrated verdict is pending and no dispatch has run.

if (event === 'PreToolUse' && /^(Write|Edit|MultiEdit)$/.test(toolName)) {
  if (!hasCx(cwd)) process.exit(0);
  const state = readState(cwd);
  if (!state?.pending || state?.dispatched) process.exit(0);
  if (typeof state.ts === 'number' && Date.now() - state.ts > STALE_MS) process.exit(0);

  const ti = input?.tool_input || {};
  const filePath = ti.file_path || ti.filePath || '';
  if (!isDeliverableArtifact(filePath, cwd)) process.exit(0);

  const authored = authoredContent(toolName, ti);
  const lineCount = authored ? authored.split('\n').length : 0;
  if (authored.length < SUBSTANTIAL_CHARS && lineCount < SUBSTANTIAL_LINES) process.exit(0);

  process.stderr.write(
    '⛔ orchestration-dispatch-guard: orchestration_policy classified this request as ORCHESTRATED, '
    + 'but no specialist dispatch (orchestration_run / Task) has run yet.\n'
    + 'You may not author the deliverable solo. Emit the task-packet and dispatch the chain '
    + '(e.g. cx-architect owns structure, cx-security challenges the credential/state model, '
    + 'cx-reviewer pressure-tests the approach), then synthesize their verdicts in Construct\'s voice.\n'
    + 'If this write IS post-dispatch synthesis, run the dispatch tool first so the guard clears.\n',
  );
  process.exit(2);
}

process.exit(0);

// A deliverable is a markdown doc/strategy artifact outside the routine
// planning and tracking files. Code paths are intentionally excluded — see
// the file header.

function isDeliverableArtifact(filePath, root) {
  if (!filePath || !/\.mdx?$/.test(filePath)) return false;
  let rel = filePath;
  try { rel = isAbsolute(filePath) ? relative(root, filePath) : filePath; } catch { rel = filePath; }
  rel = rel.replace(/\\/g, '/');
  if (rel.startsWith('..')) return false;
  if (rel.startsWith('.cx/')) return false;
  const base = basename(rel).toLowerCase();
  const routine = new Set(['plan.md', 'changelog.md', 'readme.md', 'agents.md', 'contributing.md']);
  if (routine.has(base)) return false;
  if (rel.startsWith('.cx/handoffs/') || rel.includes('/handoffs/')) return false;
  return true;
}

function authoredContent(name, ti) {
  if (name === 'Write') return String(ti.content ?? '');
  if (name === 'Edit') return String(ti.new_string ?? '');
  if (name === 'MultiEdit' && Array.isArray(ti.edits)) {
    return ti.edits.map((e) => String(e?.new_string ?? '')).join('\n');
  }
  return '';
}
