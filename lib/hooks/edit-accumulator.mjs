#!/usr/bin/env node
/**
 * lib/hooks/edit-accumulator.mjs — Edit accumulator hook — batches and summarizes recent file edits for context.
 *
 * Runs as PostToolUse after Edit/Write. Maintains a rolling log of recent edits in ~/.cx/edit-log.json for use by other hooks and efficiency reporting.
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const TS_EXTS = new Set(['.ts','.tsx','.js','.mjs','.jsx','.cjs']);
const filePath = process.env.TOOL_INPUT_FILE_PATH || '';

if (!filePath) process.exit(0);

const ext = '.' + filePath.split('.').pop();
const home = homedir();
const countPath = `${home}/.cx/files-changed-count.txt`;

// Always increment the total files-changed counter for notify
try {
  const current = existsSync(countPath) ? parseInt(readFileSync(countPath, 'utf8').trim() || '0', 10) : 0;
  writeFileSync(countPath, String(current + 1));
} catch { /* best effort */ }

// Only accumulate TS/JS files for typecheck
if (!TS_EXTS.has(ext)) process.exit(0);

const tcPath = `${home}/.cx/pending-typecheck.txt`;
try {
  const existing = existsSync(tcPath) ? readFileSync(tcPath, 'utf8').split('\n').filter(Boolean) : [];
  if (!existing.includes(filePath)) {
    appendFileSync(tcPath, filePath + '\n');
  }
} catch { /* best effort */ }

process.exit(0);
