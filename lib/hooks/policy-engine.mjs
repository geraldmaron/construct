#!/usr/bin/env node
/**
 * lib/hooks/policy-engine.mjs — consolidated session policy enforcement hook.
 *
 * Handles three hook events:
 *   PreToolUse        bootstrap gating (Write/Edit blocked until session is grounded)
 *   Stop              red-CI block, open-beads block, drive-mode criteria, drive-session advisory
 *   UserPromptSubmit  reserved for workflow rule (no-op today)
 *
 * Bypasses (env vars):
 *   CONSTRUCT_STOP_OK_RED_CI=1   acknowledge red CI and allow stop
 *   CONSTRUCT_STOP_OK_OPEN_BD=1  acknowledge open in_progress beads issues and allow stop
 *
 * @p95ms 80
 * @maxBlockingScope PreToolUse, Stop, UserPromptSubmit
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { process.exit(0); }

const hookEvent = process.env.CONSTRUCT_HOOK_EVENT || input?.hook_event || process.argv[2] || '';
const toolName = input?.tool_name || input?.tool || '';
const toolInput = input?.tool_input || {};
const cwd = input?.cwd || process.cwd();
const home = homedir();

function safeExec(cmd, opts = {}) {
  try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, ...opts }).toString().trim(); }
  catch { return null; }
}

if (hookEvent === 'PreToolUse') {
  const BOOTSTRAP_TOOLS = new Set([
    'mcp__construct-mcp__project_context',
    'mcp__construct-mcp__memory_search',
    'project_context', 'memory_search',
  ]);
  const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
  const BLOCKED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'TodoWrite']);
  const BENIGN_BASH = /^(git (status|log|diff|branch|show|rev-parse|ls-files|blame|stash list|tag|show-branch|grep)|ls|cat|head|tail|pwd|wc|file|echo|which|env|true|false|date|whoami|hostname|uname|grep|rg|find|fd|du|df|ps|lsof|jq|sort|uniq|cut|tr|awk|tee|stat|test|node --version|npm --version|npm test|sed -n)\b/;

  const stateDir = join(home, '.cx');
  const statePath = join(stateDir, 'bootstrap-state.json');
  const sessionId = input.session_id || input.sessionId || 'default';

  let state = {};
  if (existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, 'utf8')) || {}; } catch { state = {}; }
  }
  const now = Date.now();
  for (const [k, v] of Object.entries(state)) {
    if (!v?.ts || now - v.ts > 24 * 60 * 60 * 1000) delete state[k];
  }

  const s = state[sessionId] || { ts: now, reads: 0, bootstrap: [], done: false };
  const bootstrapSet = new Set(Array.isArray(s.bootstrap) ? s.bootstrap : []);
  s.ts = now;

  if (BOOTSTRAP_TOOLS.has(toolName)) bootstrapSet.add(toolName.replace(/^.*__/, ''));
  if (READ_TOOLS.has(toolName)) s.reads = (s.reads || 0) + 1;

  if (!s.done) {
    const hasPair = bootstrapSet.has('project_context') && bootstrapSet.has('memory_search');
    if (hasPair || (s.reads || 0) >= 3) s.done = true;
  }
  if (!s.done && READ_TOOLS.has(toolName) && (s.reads || 0) >= 2) s.done = true;

  let block = false;
  let reason = '';
  if (!s.done) {
    if (BLOCKED_TOOLS.has(toolName)) {
      block = true;
      reason = `${toolName} requires session bootstrap.`;
    } else if (toolName === 'Bash') {
      const cmd = (toolInput.command || '').trim();
      if (cmd && !BENIGN_BASH.test(cmd)) { block = true; reason = 'Bash mutations require session bootstrap.'; }
    }
  }

  try {
    mkdirSync(stateDir, { recursive: true });
    state[sessionId] = { ...s, bootstrap: Array.from(bootstrapSet) };
    writeFileSync(statePath, JSON.stringify(state));
  } catch {}

  if (block) {
    process.stderr.write(
      `[policy-engine/bootstrap] ${reason}\n` +
      `Run in parallel first: project_context, memory_search.\n` +
      `(Or do 3+ exploratory reads — Read/Grep/Glob/LS.)\n`
    );
    process.exit(2);
  }

  process.exit(0);
}

if (hookEvent === 'Stop') {
  const driveStatePath = join(cwd, '.cx', 'drive-state.json');

  if (existsSync(driveStatePath)) {
    let driveState = {};
    try { driveState = JSON.parse(readFileSync(driveStatePath, 'utf8')); } catch { driveState = {}; }

    if (driveState.active && !driveState.canStop) {
      const allCriteria = Array.isArray(driveState.criteria) ? driveState.criteria : [];
      const criteriaStatus = driveState.criteriaStatus || {};
      const metCriteria = allCriteria.filter(c => criteriaStatus[c]?.met);
      const unmetCriteria = allCriteria.filter(c => !criteriaStatus[c]?.met);
      const pendingTodos = driveState.pendingTodos || 0;
      const iteration = driveState.iteration || 1;
      const momentum = driveState.momentumScore != null ? Math.round(driveState.momentumScore * 100) : null;

      const hasPendingWork = unmetCriteria.length > 0 || (allCriteria.length === 0 && pendingTodos > 0);
      if (hasPendingWork) {
        const lines = [`[policy-engine/drive] Drive mode active — iteration ${iteration}. Cannot stop yet.`, ''];
        if (unmetCriteria.length > 0) {
          lines.push(`Unmet criteria (${unmetCriteria.length}/${allCriteria.length}):`);
          for (const c of unmetCriteria) lines.push(`  ✗ ${c}`);
          lines.push('');
        }
        if (metCriteria.length > 0) {
          lines.push(`Verified criteria (${metCriteria.length}/${allCriteria.length}):`);
          for (const c of metCriteria) {
            const ev = criteriaStatus[c]?.evidence || 'recorded';
            lines.push(`  ✓ ${c} — ${ev.slice(0, 80)}`);
          }
          lines.push('');
        }
        if (allCriteria.length === 0) {
          lines.push(`Remaining: ${pendingTodos} pending todos`, '');
        }
        if (momentum != null) lines.push(`Momentum: ${momentum}% (iteration ${iteration})`);
        lines.push('', `[policy-engine/drive] Set criteriaStatus["<criterion>"] = { met: true, evidence: "..." } to unblock.`);

        process.stderr.write(lines.join('\n') + '\n');
        process.exit(2);
      }
    }
  }

  const branch = safeExec('git branch --show-current');
  const isFeatureBranch = branch && branch !== 'main' && branch !== 'dev' && branch !== 'master';
  const filesChangedPath = join(home, '.cx', 'files-changed-count.txt');
  let filesChanged = 0;
  try { filesChanged = parseInt(readFileSync(filesChangedPath, 'utf8').trim() || '0', 10); } catch {}

  if (isFeatureBranch && filesChanged > 0 && process.env.CONSTRUCT_STOP_OK_RED_CI !== '1') {
    const json = safeExec(
      `gh run list --branch=${JSON.stringify(branch)} --limit=1 --json conclusion,databaseId,url`,
      { timeout: 4000 },
    );
    if (json) {
      let run = null;
      try { [run] = JSON.parse(json); } catch {}
      if (run?.conclusion === 'failure') {
        process.stderr.write(
          `[policy-engine/red-ci] Cannot end session — CI is red on '${branch}'.\n` +
          `  Run: ${run.url || `gh run view ${run.databaseId}`}\n` +
          `  Logs: gh run view ${run.databaseId} --log-failed\n` +
          `  Fix the failure, or acknowledge with CONSTRUCT_STOP_OK_RED_CI=1.\n`,
        );
        process.exit(2);
      }
    }
  }

  if (process.env.CONSTRUCT_STOP_OK_OPEN_BD !== '1' && safeExec('command -v bd', { timeout: 1000 })) {
    const bdJson = safeExec('bd list --status in_progress --json', { timeout: 3000 });
    if (bdJson) {
      let issues = [];
      try { issues = JSON.parse(bdJson) || []; } catch {}
      if (Array.isArray(issues) && issues.length > 0) {
        const lines = issues.slice(0, 10).map((iss) => {
          const id = iss.id || iss.ID || '?';
          const title = iss.title || iss.summary || '';
          return `  - ${id}: ${title}`;
        });
        process.stderr.write(
          `[policy-engine/open-bd] In-progress beads issues remain (${issues.length} total):\n` +
          lines.join('\n') + '\n' +
          `  Close (bd close <id>) or acknowledge with CONSTRUCT_STOP_OK_OPEN_BD=1.\n`,
        );
        process.exit(2);
      }
    }
  }

  const driveSessionPath = join(home, '.cx', 'drive-session.json');
  if (existsSync(driveSessionPath)) {
    let ds = {};
    try { ds = JSON.parse(readFileSync(driveSessionPath, 'utf8')); } catch {}
    if (ds?.open === true) {
      const id = ds.sessionId || ds.id || '<unknown>';
      const goal = ds.goal || ds.title || '';
      process.stderr.write(
        `[policy-engine/drive-session] Open drive session detected (id ${id}).\n` +
        (goal ? `  Goal: ${goal}\n` : '') +
        `  Close it before assuming session is complete (advisory).\n`,
      );
    }
  }

  process.exit(0);
}

if (hookEvent === 'UserPromptSubmit') {
  process.exit(0);
}

process.exit(0);
