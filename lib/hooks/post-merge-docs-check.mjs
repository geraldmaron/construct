#!/usr/bin/env node
/**
 * post-merge-docs-check.mjs — PostToolUse / Bash (async)
 *
 * When a merge or pull lands on the working tree (detected via `git log -1
 * --format=%P` returning two parents), diff the merge and emit
 * `pr.merged.no-docs` if `src/`, `lib/`, or `bin/` changed without a touching
 * file under `docs/**` or `CHANGELOG.md`. Emits `changelog.missing`
 * specifically when no CHANGELOG entry was added.
 *
 * @p95ms 1500
 * @maxBlockingScope none (async, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Bash
 * @exits 0 = pass
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { logHookFailure } from './_lib/log.mjs';
import { emitRoleEvent } from '../roles/hook-emit.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'post-merge-docs-check', err, phase: 'parse' }); process.exit(0); }

const command = input?.tool_input?.command || '';
const exitCode = input?.tool_response?.exit_code ?? input?.tool_response?.exitCode;
const isMergePull = /\bgit\s+(merge|pull|rebase|cherry-pick)\b/.test(command);
if (!isMergePull) process.exit(0);
if (exitCode !== 0 && exitCode !== undefined) process.exit(0);

const cwd = input?.cwd || process.cwd();

try {
  const parents = execSync('git log -1 --format=%P', { cwd, timeout: 2000 }).toString().trim();
  if (parents.split(/\s+/).filter(Boolean).length < 2) process.exit(0);

  const files = execSync('git diff-tree --no-commit-id --name-only -r HEAD', { cwd, timeout: 2000 })
    .toString().split('\n').filter(Boolean);

  const codeChanged = files.some((f) => /^(src|lib|bin|app)\//.test(f));
  if (!codeChanged) process.exit(0);

  const docChanged = files.some((f) => /^docs\//.test(f) || /(^|\/)README\.md$/.test(f));
  const changelogChanged = files.some((f) => /(^|\/)CHANGELOG\.md$/.test(f));

  if (!changelogChanged) {
    emitRoleEvent({
      type: 'changelog.missing',
      summary: `Merge landed without CHANGELOG update — ${files.length} file(s) changed`,
      hookInput: input,
      context: { files: files.slice(0, 50) },
    });
  }
  if (!docChanged && !changelogChanged) {
    emitRoleEvent({
      type: 'pr.merged.no-docs',
      summary: `Merge landed touching code without docs — ${files.length} file(s) changed`,
      hookInput: input,
      context: { files: files.slice(0, 50) },
    });
  }
} catch {}

process.exit(0);
