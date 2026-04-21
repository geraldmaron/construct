#!/usr/bin/env node
/**
 * lib/hooks/continuation-enforcer.mjs — Continuation enforcer hook — ensures agents complete tasks before stopping.
 *
 * Runs as PreToolUse on Stop. Checks workflow state for incomplete tasks and blocks the stop if high-priority work is unfinished, prompting the agent to continue.
 */
// PostToolUse(TodoWrite) — fires after every todo list update.
// 1. Counts remaining tasks and reminds agent to continue.
// 2. Updates .cx/drive-state.json with current loop iteration state.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const todos = input?.tool_input?.todos || [];

const pending = todos.filter(t => t.status === 'pending');
const inProgress = todos.filter(t => t.status === 'in_progress');
const done = todos.filter(t => t.status === 'completed');
const remaining = pending.length + inProgress.length;

if (remaining > 0) {
  const parts = [`[continuation-enforcer] ${remaining} task${remaining !== 1 ? 's' : ''} remain. Continue until all are complete.`];
  if (inProgress.length > 0) parts.push(`  In progress: ${inProgress.map(t => t.content).join(', ')}`);
  if (pending.length > 0) {
    const shown = pending.slice(0, 5).map(t => t.content).join(', ');
    const more = pending.length > 5 ? ` (+${pending.length - 5} more)` : '';
    parts.push(`  Pending: ${shown}${more}`);
  }
  process.stdout.write(parts.join('\n') + '\n');
}

// Update .cx/drive-state.json if drive mode is active
const driveStatePath = join(cwd, '.cx', 'drive-state.json');
if (!existsSync(driveStatePath)) process.exit(0);

try {
  let ds = {};
  try { ds = JSON.parse(readFileSync(driveStatePath, 'utf8')); } catch { /* fresh */ }

  if (!ds.active) process.exit(0);

  const total = todos.length;
  ds.pendingTodos = remaining;
  ds.updatedAt = new Date().toISOString();
  ds.momentumScore = total > 0 ? done.length / total : 0;
  ds.canStop = remaining === 0;

  // Track current iteration snapshot
  if (!ds.iterations) ds.iterations = [];
  const n = ds.iteration || 1;
  const existing = ds.iterations.findIndex(i => i.n === n);
  const snapshot = {
    n,
    updatedAt: new Date().toISOString(),
    pendingTodos: remaining,
    doneTodos: done.length,
    totalTodos: total,
    inProgress: inProgress.map(t => t.content),
  };
  if (existing >= 0) ds.iterations[existing] = { ...ds.iterations[existing], ...snapshot };
  else ds.iterations.push(snapshot);

  // Increment iteration when all todos complete — ready for next loop pass
  if (remaining === 0 && total > 0) ds.iteration = (ds.iteration || 1) + 1;

  writeFileSync(driveStatePath, JSON.stringify(ds, null, 2));
} catch { /* best effort */ }

process.exit(0);
