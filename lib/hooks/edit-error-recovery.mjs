#!/usr/bin/env node
/**
 * lib/hooks/edit-error-recovery.mjs — Edit error recovery hook — recovers from failed edit attempts and suggests fixes.
 *
 * Runs as PostToolUse when Edit tool returns an error. Reads the error and provides a targeted fix suggestion based on the error type (e.g., old_string not found).
 */
import { readFileSync } from 'fs';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const EDIT_FAILURE_PATTERNS = [
  'no match found', 'string not found', 'old_string not found',
  'file not found', 'no such file', 'cannot find',
  'already exists', 'permission denied', 'eacces', 'enoent',
  'content mismatch', 'conflict', 'stale',
];

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';
if (!EDIT_TOOLS.has(toolName)) process.exit(0);

const errorText = (
  input?.error || input?.message ||
  (input?.tool_response ? JSON.stringify(input.tool_response) : '') || ''
).toLowerCase();

const isEditFailure = EDIT_FAILURE_PATTERNS.some(p => errorText.includes(p));
if (!isEditFailure) process.exit(0);

const filePath = input?.tool_input?.file_path || input?.tool_input?.path || '';

process.stdout.write([
  ``,
  `✗ ${toolName} failed${filePath ? ` on ${filePath}` : ''}.`,
  ``,
  `Recovery steps:`,
  `1. Re-read the file with Read before retrying — content may have changed since your last read`,
  `2. Use a longer old_string with 3-5 lines of surrounding context to make the match unique`,
  `3. Check exact whitespace and indentation — tabs vs spaces matter`,
  `4. If the file doesn't exist yet, use Write instead of Edit`,
  `5. If getting "already exists" on Write, read the file first and use Edit`,
  ``,
].join('\n'));

process.exit(0);
