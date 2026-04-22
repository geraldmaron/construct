#!/usr/bin/env node
/**
 * lib/hooks/teammate-idle-guard.mjs — Teammate idle guard hook — warns when a spawned agent has been idle too long.
 *
 * Runs as PostToolUse after Agent tool calls. Tracks agent start times and emits a warning if an agent appears idle or unresponsive beyond the idle threshold.
 */
import { loadWorkflow } from '../workflow-state.mjs';

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function namesFromInput(input) {
  return [
    input.teammate,
    input.teammate_name,
    input.agent,
    input.agent_name,
    input.name,
  ].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
}

const input = await readInput();
const cwd = input.cwd || input.workspace_dir || process.cwd();
const names = namesFromInput(input);
const workflow = loadWorkflow(cwd);

if (!workflow || names.length === 0) process.exit(0);

const active = (workflow.tasks || []).find((task) =>
  names.includes(task.owner)
  && task.status === 'in-progress'
  && (!Array.isArray(task.notes) || task.notes.length === 0)
  && (!Array.isArray(task.verification) || task.verification.length === 0)
);

if (!active) process.exit(0);

process.stderr.write([
  `[construct] ${names[0]} is going idle with active task ${active.key} but no workflow update.`,
  'Before going idle, update .cx/workflow.json with one of:',
  '- status=done plus verification evidence',
  '- status=blocked with the blocker',
  '- status=blocked_needs_user and a NEEDS_MAIN_INPUT packet for the primary persona',
  '',
].join('\n'));
process.exit(2);
