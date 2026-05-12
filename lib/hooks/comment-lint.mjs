#!/usr/bin/env node
/**
 * lib/hooks/comment-lint.mjs — PostToolUse hook: enforce the comment policy at write time.
 *
 * Runs after Write/Edit/MultiEdit on scoped paths. Blocks the edit (exit 2)
 * if the file violates the policy — missing required header, banned patterns,
 * narrative voice, point-in-time notes, noise sentinels. The agent sees the
 * block reason and is expected to fix the comment before continuing.
 *
 * Bypass: set CONSTRUCT_SKIP_COMMENT_LINT=1 in the environment.
 *
 * Input: reads tool_input.file_path from either the legacy TOOL_INPUT_FILE_PATH
 * env var or modern stdin JSON ({ tool_input: { file_path } }).
 *
 * @p95ms 60
 * @maxBlockingScope PostToolUse
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFile, formatResults } from '../comment-lint.mjs';

if (process.env.CONSTRUCT_SKIP_COMMENT_LINT === '1') process.exit(0);

let filePath = process.env.TOOL_INPUT_FILE_PATH;
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  } catch {}
}
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
if (!['.mjs', '.md', '.sh', '.js'].includes(ext)) process.exit(0);

const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const result = lintFile(filePath, { rootDir });
if (!result.errors.length && !result.warnings.length) process.exit(0);

const { output } = formatResults([result]);
process.stderr.write(output);
process.stderr.write(
  '\nComment policy blocked this edit. Remove the violations or set CONSTRUCT_SKIP_COMMENT_LINT=1.\n',
);
process.exit(2);
