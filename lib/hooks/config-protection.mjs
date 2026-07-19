#!/usr/bin/env node
/**
 * lib/hooks/config-protection.mjs — protects code-quality config from being weakened.
 *
 * Runs as PreToolUse on Edit|Write|MultiEdit. Blocks edits to eslint /
 * prettier / tsconfig / biome / stylelint configs — but only once the config
 * is an established contract, i.e. tracked in git. A config that is not yet
 * tracked is being introduced or authored: first-time setup and pre-commit
 * iteration are allowed; weakening a committed config stays blocked.
 *
 * Meta-system files (hooks, registry, settings template, install/setup
 * entrypoints) are audited but NOT blocked. Editing them is normal work on
 * Construct itself. The previous block-with-CONSTRUCT_ALLOW_META_EDIT pattern was a
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
 * @exits 0 = always, emits audit event on violation
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { logHookFailure } from './_lib/log.mjs';

const filePath = process.env.TOOL_INPUT_FILE_PATH || (() => {
  try { return JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path || ''; }
  catch (err) { logHookFailure({ hook: 'config-protection', err, phase: 'parse' }); return ''; }
})();

if (!filePath) process.exit(0);

// Lint-RULE configs are hard contracts with the codebase: weakening a rule is
// almost always a bug fix in disguise, so edits are blocked. tsconfig is the TS
// COMPILER config — its options legitimately change with the toolchain (e.g. a
// version-compat flag like ignoreDeprecations on a major TS bump), so it is
// audited as a meta edit rather than blocked. Quality-relevant tsconfig changes
// still surface in code review and the type-checked build.
const PROTECTED = [
  /\.eslintrc(\.[a-z]+)?$/i,
  /eslint\.config(\.[a-z]+)?$/i,
  /\.prettierrc(\.[a-z]+)?$/i,
  /prettier\.config(\.[a-z]+)?$/i,
  /biome\.json$/i,
  /\.stylelintrc(\.[a-z]+)?$/i,
  /stylelint\.config(\.[a-z]+)?$/i,
];

const META_FILES = [
  /(?:^|\/)specialists\/org(?:\/|$)/,
  /(?:^|\/)lib\/setup\.mjs$/,
  /(?:^|\/)bin\/construct-postinstall\.mjs$/,
  /(?:^|\/)claude\/settings\.template\.json$/,
  /(?:^|\/)lib\/hooks\/[^/]+\.mjs$/,
  /(?:^|\/)tsconfig(\.[^/]+)?\.json$/i,
];

// A config is a contract worth protecting only once it is committed. `git
// ls-files --error-unmatch` exits 0 for a tracked path and non-zero otherwise,
// so an untracked (newly introduced) config is allowed through.

function isTrackedInGit(p) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', p], {
      cwd: dirname(p), stdio: 'ignore', timeout: 1000,
    });
    return true;
  } catch {
    return false;
  }
}

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
if (PROTECTED.some(r => r.test(base)) && isTrackedInGit(filePath)) {
  process.stderr.write(
    `[config-protection] The code quality rules are protected. You are editing a tracked config file. Ensure you are not weakening rules just to bypass errors.\nFile: ${filePath}\n`
  );
  await emitEvent('config.protection.violation', 'code-quality-config', `Edited code-quality-config: ${filePath}`);
  process.exit(0);
}

if (META_FILES.some(r => r.test(filePath))) {
  await emitEvent('meta.edit', 'meta-system', `Meta-system edit: ${filePath}`);
}

process.exit(0);
