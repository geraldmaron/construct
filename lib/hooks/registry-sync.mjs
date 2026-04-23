#!/usr/bin/env node
/**
 * lib/hooks/registry-sync.mjs — Registry sync hook — reminds to run construct sync after registry changes.
 *
 * Runs as PostToolUse after edits to agents/registry.json. Checks if the file was modified and emits a reminder to run construct sync to regenerate platform adapters.
 *
 * @p95ms 12000
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { execSync } from 'child_process';

const filePath = process.env.TOOL_INPUT_FILE_PATH || '';
if (!filePath.endsWith('/agents/registry.json')) process.exit(0);

const toolkitDir = process.env.CX_TOOLKIT_DIR || `${process.env.HOME}/.construct`;
try {
  execSync('node sync-agents.mjs', {
    cwd: toolkitDir,
    stdio: 'pipe',
    env: { ...process.env, CX_TOOLKIT_DIR: toolkitDir },
    timeout: 12_000,
  });
} catch (e) {
  process.stderr.write(`[registry-sync] Sync failed: ${e.message}\n`);
}
process.exit(0);
