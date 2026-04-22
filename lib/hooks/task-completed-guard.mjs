#!/usr/bin/env node
/**
 * lib/hooks/task-completed-guard.mjs — Task completed guard hook — enforces verification evidence before marking tasks done.
 *
 * Runs as PreToolUse on workflow_update_task. Checks that implement-phase tasks include verification evidence before allowing status to be set to done. Exits 2 to block.
 */
import { loadWorkflow, validateWorkflowState } from '../workflow-state.mjs';

function readInput() {
  try {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    return new Promise((resolve) => {
      process.stdin.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });
  } catch {
    return {};
  }
}

const input = await readInput();
const cwd = input.cwd || input.workspace_dir || process.cwd();
const workflow = loadWorkflow(cwd);

if (!workflow) process.exit(0);

const result = validateWorkflowState(workflow);
if (result.valid) process.exit(0);

process.stderr.write([
  '[construct] Task completion blocked by workflow validation.',
  ...result.errors.map((error) => `- ${error}`),
  'Update .cx/workflow.json with owner, acceptance criteria, dependencies, and verification before marking the task complete.',
  '',
].join('\n'));
process.exit(2);
