#!/usr/bin/env node
/**
 * lib/hooks/policy-engine.mjs — consolidated session policy enforcement hook.
 *
 * Handles three hook events: PreToolUse (bootstrap gating, MCP scope, task-completion
 * validation), Stop (drive-mode criteria enforcement), and UserPromptSubmit (workflow
 * routing). Policy rules are declared in rules/policy/*.yaml.
 *
 * @p95ms 40
 * @maxBlockingScope PreToolUse, Stop, UserPromptSubmit
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadWorkflow, validateWorkflowState, alignmentFindings, summarizeWorkflow } from '../workflow-state.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')) || {}; } catch { process.exit(0); }

const hookEvent = process.env.CONSTRUCT_HOOK_EVENT || input?.hook_event || '';
const toolName = input?.tool_name || input?.tool || '';
const toolInput = input?.tool_input || {};
const cwd = input?.cwd || process.cwd();
const home = homedir();

// ─── Bootstrap policy ────────────────────────────────────────────────────────
// Blocks Write/Edit/destructive Bash until session has grounded itself.

if (hookEvent === 'PreToolUse') {
  const BOOTSTRAP_TOOLS = new Set([
    'mcp__construct-mcp__workflow_status', 'mcp__construct-mcp__project_context',
    'mcp__construct-mcp__memory_search', 'mcp__cass__memory_search',
    'workflow_status', 'project_context', 'memory_search',
  ]);
  const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
  const BLOCKED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'TodoWrite']);
  const BENIGN_BASH = /^(git (status|log|diff|branch|show|rev-parse)|ls|cat|head|tail|pwd|wc|file|echo|which|node --version|npm --version)\b/;

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
    const hasTrio = bootstrapSet.has('workflow_status') && bootstrapSet.has('project_context') && bootstrapSet.has('memory_search');
    if (hasTrio || (s.reads || 0) >= 3) s.done = true;
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
  } catch { /* best effort */ }

  if (block) {
    process.stderr.write(
      `[policy-engine/bootstrap] ${reason}\n` +
      `Run in parallel first: workflow_status, project_context, memory_search.\n` +
      `(Or do 3+ exploratory reads — Read/Grep/Glob/LS.)\n`
    );
    process.exit(2);
  }

  // ─── MCP task-scope policy ──────────────────────────────────────────────────
  if (toolName.startsWith('mcp__')) {
    const match = toolName.match(/^mcp__([^_]+(?:__[^_]+)*)__/);
    if (match) {
      const mcpServer = match[1].replace(/__/g, '-');
      const workflowPath = join(cwd, '.cx', 'workflow.json');
      if (existsSync(workflowPath)) {
        try {
          const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));
          const task = (wf.tasks || []).find(t => t.key === wf.currentTaskKey);
          if (task?.mcpScope?.length > 0) {
            const inScope = task.mcpScope.some(s => mcpServer.includes(s) || s.includes(mcpServer));
            if (!inScope) {
              process.stderr.write(
                `[policy-engine/mcp-scope] ${mcpServer} not in mcpScope for task "${wf.currentTaskKey}".\n` +
                `Declared scope: ${task.mcpScope.join(', ')}. Proceeding — verify this call is intentional.\n`
              );
            }
          }
        } catch { /* best effort */ }
      }
    }
  }

  // ─── Task-completed policy ──────────────────────────────────────────────────
  if (toolName.includes('workflow_update_task')) {
    const workflow = loadWorkflow(cwd);
    if (workflow) {
      const result = validateWorkflowState(workflow);
      if (!result.valid) {
        process.stderr.write([
          '[policy-engine/task-complete] Task completion blocked by workflow validation.',
          ...result.errors.map((e) => `- ${e}`),
          'Update .cx/workflow.json with owner, acceptance criteria, and verification before marking done.',
          '',
        ].join('\n'));
        process.exit(2);
      }
    }
  }

  process.exit(0);
}

// ─── Stop policy (drive-guard) ────────────────────────────────────────────────

if (hookEvent === 'Stop') {
  const driveStatePath = join(cwd, '.cx', 'drive-state.json');
  const workflowPath = join(cwd, '.cx', 'workflow.json');

  if (!existsSync(driveStatePath)) process.exit(0);

  let driveState = {};
  try { driveState = JSON.parse(readFileSync(driveStatePath, 'utf8')); } catch { process.exit(0); }

  if (!driveState.active || driveState.canStop) process.exit(0);

  let allCriteria = [];
  let pendingTaskCount = 0;
  try {
    const wf = JSON.parse(readFileSync(workflowPath, 'utf8'));
    const activeTasks = (wf.tasks || []).filter(t => t.status !== 'done' && t.status !== 'skipped');
    pendingTaskCount = activeTasks.length;
    for (const t of activeTasks) {
      for (const c of (t.acceptanceCriteria || [])) {
        if (!allCriteria.includes(c)) allCriteria.push(c);
      }
    }
  } catch { /* no workflow */ }

  const criteriaStatus = driveState.criteriaStatus || {};
  const metCriteria = allCriteria.filter(c => criteriaStatus[c]?.met);
  const unmetCriteria = allCriteria.filter(c => !criteriaStatus[c]?.met);
  const pendingTodos = driveState.pendingTodos || 0;
  const iteration = driveState.iteration || 1;
  const momentum = driveState.momentumScore != null ? Math.round(driveState.momentumScore * 100) : null;

  const hasPendingWork = unmetCriteria.length > 0 || (allCriteria.length === 0 && (pendingTodos > 0 || pendingTaskCount > 0));
  if (!hasPendingWork) process.exit(0);

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
    lines.push(`Remaining: ${pendingTodos} todos, ${pendingTaskCount} workflow tasks`, '');
  }
  if (momentum != null) lines.push(`Momentum: ${momentum}% (iteration ${iteration})`);
  lines.push('', `[policy-engine/drive] Set criteriaStatus["<criterion>"] = { met: true, evidence: "..." } to unblock.`);

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

// ─── UserPromptSubmit policy (workflow-guard) ─────────────────────────────────

if (hookEvent === 'UserPromptSubmit') {
  const text = [
    input?.prompt, input?.message, input?.transcript,
    input?.last_message, input?.assistant_message,
  ].filter(Boolean).join('\n').toLowerCase();

  if (/\b(stop|pause|halt|enough|abort|cancel)\b/.test(text)) process.exit(0);

  const workflow = loadWorkflow(cwd);
  if (!workflow || workflow.status !== 'in-progress') process.exit(0);

  const tasks = workflow.tasks || [];
  const openTasks = tasks.filter(t => !['done', 'skipped'].includes(t.status));
  const findings = alignmentFindings(workflow).filter(f => f.severity === 'HIGH');

  if (openTasks.length === 0 && findings.length === 0) process.exit(0);

  const next = tasks.find(t => t.key === workflow.currentTaskKey) || openTasks[0];
  const lines = ['Construct workflow is still active.', summarizeWorkflow(workflow)];
  if (next) lines.push(`Next task: ${next.key} ${next.title} → ${next.owner} [${next.status}]`);
  if (findings.length > 0) {
    lines.push(`Alignment blockers: ${findings.length}`);
    for (const f of findings.slice(0, 3)) lines.push(`- ${f.task ? `${f.task}: ` : ''}${f.issue}`);
  }
  lines.push('Continue the workflow, update .cx/workflow.json, or say stop/pause to end.');

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

process.exit(0);
