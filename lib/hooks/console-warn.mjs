#!/usr/bin/env node
/**
 * lib/hooks/console-warn.mjs — Console warn hook — warns when console.log/debug statements are left in code.
 *
 * Runs as PostToolUse after Edit/Write. Detects console.log and console.debug statements in edited files and emits a warning. Does not block — informational only.
 */
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { basename } from 'path';

const CODE_EXTS = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const filePath = process.env.TOOL_INPUT_FILE_PATH || '';

if (!filePath) process.exit(0);

const ext = '.' + filePath.split('.').pop();
if (!CODE_EXTS.has(ext)) process.exit(0);

if (!existsSync(filePath)) process.exit(0);

const lines = readFileSync(filePath, 'utf8').split('\n');
const hits = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  if (/\bconsole\.(log|warn|error|info|debug)\s*\(/.test(stripped) || /\bdebugger\s*;/.test(stripped)) {
    hits.push(i + 1);
  }
}

if (hits.length === 0) process.exit(0);

const file = basename(filePath);
const lineList = hits.slice(0, 5).join(', ') + (hits.length > 5 ? '…' : '');
const msg = `Heads up: debug statements left in ${file} — console.log on line${hits.length > 1 ? 's' : ''} ${lineList}. Remove before shipping.`;

process.stderr.write(`[console-warn] ${msg}\n`);

const flagsPath = `${homedir()}/.cx/warn-flags.txt`;
try { appendFileSync(flagsPath, `console.log in ${file} (lines ${lineList})\n`); } catch { /* best effort */ }

process.exit(0);
