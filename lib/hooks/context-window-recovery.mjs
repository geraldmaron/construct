#!/usr/bin/env node
/**
 * lib/hooks/context-window-recovery.mjs — Context window recovery hook — detects near-limit context and suggests compaction.
 *
 * Runs as PostToolUse. Reads context usage from the hook input and emits a compaction suggestion when the context window is above 80%. Non-blocking.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { loadWorkflow, summarizeWorkflow } from '../workflow-state.mjs';
import { readContextState, writeContextState } from '../context-state.mjs';

const CONTEXT_LIMIT_PATTERNS = [
  'context window', 'maximum context', 'too long', 'prompt is too long',
  'context length exceeded', 'reduce the length', 'token limit', 'context limit',
  'input is too long', 'exceeds the maximum',
];

const COOLDOWN_MS = 10 * 60 * 1000;
const STATE_PATH = join(homedir(), '.cx', 'context-recovery.json');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const errorText = (
  input?.error || input?.message ||
  (input?.tool_response ? JSON.stringify(input.tool_response) : '') || ''
).toLowerCase();

const isContextLimit = CONTEXT_LIMIT_PATTERNS.some(p => errorText.includes(p));
if (!isContextLimit) process.exit(0);

const now = Date.now();
try {
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  if (now - (state.lastTriggeredAt || 0) < COOLDOWN_MS) process.exit(0);
} catch { /* first run */ }

const cxDir = join(homedir(), '.cx');
try { mkdirSync(cxDir, { recursive: true }); } catch { /* exists */ }
try { writeFileSync(STATE_PATH, JSON.stringify({ lastTriggeredAt: now })); } catch { /* best effort */ }

const cwd = input?.cwd || process.cwd();

const workflowLines = [];
try {
  const workflow = loadWorkflow(cwd);
  if (workflow) {
    const summary = summarizeWorkflow(workflow);
    workflowLines.push('## Active Workflow', summary, '');
    const pending = (workflow.tasks || []).filter(t => t.status === 'in-progress' || t.status === 'todo');
    if (pending.length) {
      workflowLines.push('## Pending Tasks');
      for (const t of pending.slice(0, 10)) {
        workflowLines.push(`- [${t.key}] ${t.title} (${t.status}, owner: ${t.owner})`);
      }
      workflowLines.push('');
    }
  }
} catch { /* best effort */ }

let existingContext = '';
try {
  const state = readContextState(cwd) || readContextState(homedir());
  if (state?.markdown) existingContext = String(state.markdown).slice(0, 800);
  else if (state?.context) existingContext = String(state.context).slice(0, 800);
} catch { /* none */ }

const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
const recoveryContext = [
  `# Session Context`,
  `Last saved: ${date} (context-window-recovery)`,
  '',
  ...workflowLines,
  existingContext ? `## Prior Context\n${existingContext}` : '',
].join('\n') + '\n';

const projectCxDir = join(cwd, '.cx');
try { mkdirSync(projectCxDir, { recursive: true }); } catch { /* exists */ }
try { writeContextState(cwd, { source: 'context-window-recovery', recoveryContext, format: 'json' }, { markdown: recoveryContext }); } catch { /* best effort */ }
try { writeContextState(homedir(), { source: 'context-window-recovery', recoveryContext, format: 'json' }, { markdown: recoveryContext }); } catch { /* best effort */ }

process.stdout.write([
  ``,
  `⚠ Context window limit hit. Session state saved to .cx/context.md.`,
  `Resume by reading .cx/context.md and .cx/workflow.json, then continue from where you left off.`,
  ``,
].join('\n'));

process.exit(0);
