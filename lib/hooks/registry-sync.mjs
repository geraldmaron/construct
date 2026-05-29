#!/usr/bin/env node
/**
 * lib/hooks/registry-sync.mjs — Registry-change reminder hook.
 *
 * PostToolUse on Write|Edit. Fires only when the edited file is
 * specialists/registry.json (the construct repo) or an installed
 * agents/registry.json mirror. Emits a one-line reminder on stderr telling
 * the developer to run `construct sync` when they're ready. Does NOT
 * auto-execute sync — auto-execution during tests (which legitimately
 * mutate registry.json) races test cleanup and regenerates platform state
 * mid-suite. The dev decides when to sync, the same way ordinary code
 * changes don't auto-build.
 *
 * To suppress the reminder in a CI run or scripted edit, set
 * CONSTRUCT_QUIET_REGISTRY_REMINDER=1.
 *
 * @p95ms 50
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import path from 'node:path';

const filePath = process.env.TOOL_INPUT_FILE_PATH || '';
const matchesRegistry =
  filePath.endsWith(path.join('agents', 'registry.json')) ||
  filePath.endsWith('/specialists/registry.json');
if (!matchesRegistry) process.exit(0);

if (process.env.CONSTRUCT_QUIET_REGISTRY_REMINDER !== '1') {
  process.stderr.write(
    `[registry-sync] registry.json changed — run \`construct sync\` to regenerate platform adapters when ready.\n`,
  );
}
process.exit(0);
