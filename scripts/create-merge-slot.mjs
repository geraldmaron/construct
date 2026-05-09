#!/usr/bin/env node
/**
 * scripts/create-merge-slot.mjs — Create merge-slot bead and ensure it's ready.
 * Run via: node scripts/create-merge-slot.mjs
 */

import { runBd } from '../lib/beads-client.mjs';

async function main() {
  const cwd = process.cwd();
  const actor = 'setup';

  console.error('[setup] Creating merge‑slot bead…');

  try {
    const existing = await runBd(['list', '--json'], { cwd, actor, silent: true });
    const issues = JSON.parse(existing.output || '[]');
    const mergeSlot = issues.find((issue) => issue.subject === 'Merge slot coordination');
    if (mergeSlot?.id) {
      console.error(`[setup] merge‑slot already exists: ${mergeSlot.id}`);
      const result = await runBd(['show', mergeSlot.id], { cwd, actor, silent: false });
      console.log(result.output || '');
      return;
    }
  } catch {
    console.error('[setup] Creating new merge‑slot bead');
  }

  // Create the merge‑slot bead
  try {
    const result = await runBd([
      'create',
      '--subject', 'Merge slot coordination',
      '--notes', 'Coordination bead for serializing batch operations like `bd dolt push` across multiple agents. Use via `bd merge-slot check` and `bd merge-slot release`.',
      '--priority', 'P0',
      '--assignee', '@geraldmaron',
      '--label', 'infrastructure',
      '--label', 'coordination',
    ], { cwd, actor, silent: false });

    console.error('[setup] Merge‑slot created');
    console.log(result.output || '');
  } catch (createError) {
    console.error(`[setup] Failed to create merge‑slot: ${createError.message}`);
    process.exit(1);
  }

  console.error('[setup] Merge‑slot created and ready');
}

main().catch(error => {
  console.error(`[setup] Unexpected error: ${error.message}`);
  process.exit(1);
});
