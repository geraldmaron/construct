#!/usr/bin/env node
/**
 * lib/hooks/edit-accumulator.mjs — accumulates edited paths for the next
 * typecheck batch.
 *
 * Runs as PostToolUse after Edit/Write. Maintains two pieces of session
 * state at ~/.cx/: a total edit counter for surface-area summaries and a
 * deduped queue of TS/JS files awaiting typecheck. The typecheck queue is
 * bounded via the `edit-accumulator` channel in lib/logging/rotate.mjs.
 *
 * @p95ms 10
 * @maxBlockingScope none (PostToolUse, non-blocking)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { logHookFailure } from './_lib/log.mjs';

const TS_EXTS = new Set(['.ts','.tsx','.js','.mjs','.jsx','.cjs']);
const filePath = process.env.TOOL_INPUT_FILE_PATH || '';

if (!filePath) process.exit(0);

const ext = path.extname(filePath);
const home = homedir();
const countPath = path.join(home, '.cx', 'files-changed-count.txt');

// Always increment the total files-changed counter for notify
try {
  const current = existsSync(countPath) ? parseInt(readFileSync(countPath, 'utf8').trim() || '0', 10) : 0;
  writeFileSync(countPath, String(current + 1));
} catch (err) {
  logHookFailure({ hook: 'edit-accumulator', err, phase: 'count' });
}

// Only accumulate TS/JS files for typecheck
if (!TS_EXTS.has(ext)) process.exit(0);

const tcPath = path.join(home, '.cx', 'pending-typecheck.txt');
try {
  const existing = existsSync(tcPath) ? readFileSync(tcPath, 'utf8').split('\n').filter(Boolean) : [];
  if (!existing.includes(filePath)) {
    appendBounded('edit-accumulator', tcPath, filePath + '\n');
  }
} catch (err) {
  logHookFailure({ hook: 'edit-accumulator', err, phase: 'append' });
}

process.exit(0);
