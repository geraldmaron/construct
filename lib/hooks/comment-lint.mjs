/**
 * lib/hooks/comment-lint.mjs — PostToolUse hook: check edited files against comment policy.
 *
 * Runs after Write/Edit on scoped paths. Emits warnings for missing headers and
 * banned patterns so violations are caught at authoring time, not at CI.
 * Non-blocking: exits 0 even on warnings so it never halts a write.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFile, formatResults } from '../comment-lint.mjs';

const filePath = process.env.TOOL_INPUT_FILE_PATH;
if (!filePath) process.exit(0);

const ext = path.extname(filePath).toLowerCase();
if (!['.mjs', '.md', '.sh', '.js'].includes(ext)) process.exit(0);

const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const result = lintFile(filePath, { rootDir });
if (!result.errors.length && !result.warnings.length) process.exit(0);

const { output } = formatResults([result]);
process.stdout.write(output);
process.exit(0);
