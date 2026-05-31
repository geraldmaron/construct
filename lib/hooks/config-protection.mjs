#!/usr/bin/env node
/**
 * lib/hooks/config-protection.mjs — protects code-quality config from being weakened.
 *
 * Runs as PreToolUse on Edit|Write|MultiEdit. Blocks edits to eslint /
 * prettier / tsconfig / biome / stylelint configs. Those rules are a contract
 * with the codebase; weakening them is almost always a bug fix in disguise.
 *
 * Meta-system files (hooks, registry, settings template, install.sh) are
 * audited but NOT blocked. Editing them is normal development work on
 * Construct itself. The previous block-with-CX_ALLOW_META_EDIT pattern was a
 * sticky env-var toggle: friction the first time, zero protection thereafter
 * because it stayed on. Layers that actually work for self-modification
 * accidents: CLAUDE.md guidance, Claude Code's auto-classifier (intent-aware),
 * and the role-event audit log this hook still writes.
 *
 * @p95ms 5
 * @maxBlockingScope PreToolUse
 *
 * @lifecycle PreToolUse
 * @matcher  Write|Edit|MultiEdit
 * @exits 0 = pass | 2 = block tool call
 */
import { readFileSync } from 'fs';
import { logHookFailure } from './_lib/log.mjs';

const filePath = process.env.TOOL_INPUT_FILE_PATH || (() => {
  try { return JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path || ''; }
  catch (err) { logHookFailure({ hook: 'config-protection', err, phase: 'parse' }); return ''; }
})();

if (!filePath) process.exit(0);

const PROTECTED = [
  /\.eslintrc(\.[a-z]+)?$/i,
  /eslint\.config(\.[a-z]+)?$/i,
  /\.prettierrc(\.[a-z]+)?$/i,
  /prettier\.config(\.[a-z]+)?$/i,
  /tsconfig(\.[^/]+)?\.json$/i,
  /biome\.json$/i,
  /\.stylelintrc(\.[a-z]+)?$/i,
  /stylelint\.config(\.[a-z]+)?$/i,
];

const META_FILES = [
  /(?:^|\/)agents\/registry\.json$/,
  /(?:^|\/)install\.sh$/,
  /(?:^|\/)claude\/settings\.template\.json$/,
  /(?:^|\/)lib\/hooks\/[^/]+\.mjs$/,
];

async function emitEvent(type, category, summary) {
  try {
    const { emitRoleEvent } = await import('../roles/hook-emit.mjs');
    emitRoleEvent({
      type,
      summary,
      hookInput: {},
      context: { filePath, category },
    });
  } catch { /* best effort */ }
}

const base = filePath.split('/').pop();
if (PROTECTED.some(r => r.test(base))) {
  process.stderr.write(
    `[config-protection] The code quality rules are protected. Fix the code to meet the existing standards — don't weaken the rules.\nFile: ${filePath}\n`
  );
  await emitEvent('config.protection.violation', 'code-quality-config', `Blocked edit to code-quality-config: ${filePath}`);
  process.exit(2);
}

if (META_FILES.some(r => r.test(filePath))) {
  await emitEvent('meta.edit', 'meta-system', `Meta-system edit: ${filePath}`);
}

process.exit(0);
