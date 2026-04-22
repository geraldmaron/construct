#!/usr/bin/env node
/**
 * lib/hooks/bash-output-logger.mjs — persists long Bash outputs to disk and nudges
 * the model to reference the log instead of re-running the command.
 *
 * Runs as PostToolUse on Bash. If stdout exceeds a threshold, writes the full
 * output to ~/.cx/bash-logs/ and emits a short stderr note that Claude sees in
 * the next turn. The current turn's conversation still contains the full output
 * (hooks cannot retroactively edit past tool outputs), but subsequent turns are
 * steered toward disk-backed references instead of re-running the same command.
 *
 * Threshold chosen conservatively at 4000 chars (~100 lines). Below that, the
 * hook is a no-op.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SIZE_THRESHOLD_CHARS = 4000;
const LOG_DIR = join(homedir(), '.cx', 'bash-logs');
const WARN_FLAGS = join(homedir(), '.cx', 'warn-flags.txt');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Bash') process.exit(0);

const stdout = String(input?.tool_response?.stdout ?? '');
const stderr = String(input?.tool_response?.stderr ?? '');
const command = String(input?.tool_input?.command ?? '');
const totalSize = stdout.length + stderr.length;

if (totalSize < SIZE_THRESHOLD_CHARS) process.exit(0);

try {
  mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(LOG_DIR, `bash-${ts}.log`);
  const payload = [
    `# Command`,
    command,
    ``,
    `# Stdout (${stdout.length} chars)`,
    stdout,
    ``,
    `# Stderr (${stderr.length} chars)`,
    stderr,
  ].join('\n');
  writeFileSync(logPath, payload, 'utf8');

  const approxLines = stdout.split('\n').length;
  const kb = Math.round(totalSize / 1024);
  process.stderr.write(
    `[bash-output-logger] Output was ${approxLines} lines (${kb} KB). ` +
    `Full log saved to ${logPath}. ` +
    `Before re-running this command, reference the log with: grep/sed/head on ${logPath}. ` +
    `Prefer \`| head -N\` or \`| tail -N\` on future runs to keep context lean.\n`
  );

  try {
    appendFileSync(
      WARN_FLAGS,
      `Bash output ${kb} KB saved to ${logPath} — prefer grepping the log over re-running.\n`,
    );
  } catch { /* best effort */ }
} catch { /* best effort */ }

process.exit(0);
