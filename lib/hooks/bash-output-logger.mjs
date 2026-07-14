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
 *
 * Bash output routinely contains resolved secrets (a test printing a live
 * key, a curl echoing an Authorization header), so the payload runs through
 * audit-trail.mjs's redactRecord — the same known-secret-value and token-shape
 * patterns that keep the audit chain clean — before it reaches disk. The log
 * directory and file are written at 0700/0600 so a persisted secret (redaction
 * is pattern-based, not a guarantee) is not also world-readable.
 *
 * @p95ms 20
 * @maxBlockingScope none (PostToolUse, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Bash
 * @exits 0 = pass
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { appendBounded } from '../logging/rotate.mjs';
import { doctorRoot } from '../config/xdg.mjs';
import { redactRecord } from '../audit-trail.mjs';

const SIZE_THRESHOLD_CHARS = 4000;
const LOG_DIR = join(doctorRoot(), 'bash-logs');
const WARN_FLAGS = join(doctorRoot(), 'warn-flags.txt');

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Bash') process.exit(0);

const stdout = String(input?.tool_response?.stdout ?? '');
const stderr = String(input?.tool_response?.stderr ?? '');
const command = String(input?.tool_input?.command ?? '');
const totalSize = stdout.length + stderr.length;

if (totalSize < SIZE_THRESHOLD_CHARS) process.exit(0);

try {
  mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  chmodSync(LOG_DIR, 0o700);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join(LOG_DIR, `bash-${ts}.log`);
  const { record } = redactRecord({ command, stdout, stderr });
  const payload = [
    `# Command`,
    record.command,
    ``,
    `# Stdout (${stdout.length} chars)`,
    record.stdout,
    ``,
    `# Stderr (${stderr.length} chars)`,
    record.stderr,
  ].join('\n');
  writeFileSync(logPath, payload, { encoding: 'utf8', mode: 0o600 });

  const approxLines = stdout.split('\n').length;
  const kb = Math.round(totalSize / 1024);
  process.stderr.write(
    `[bash-output-logger] Output was ${approxLines} lines (${kb} KB). ` +
    `Full log saved to ${logPath}. ` +
    `Before re-running this command, reference the log with: grep/sed/head on ${logPath}. ` +
    `Prefer \`| head -N\` or \`| tail -N\` on future runs to keep context lean.\n`
  );

  try {
    appendBounded(
      'bash-warn-flags',
      WARN_FLAGS,
      `Bash output ${kb} KB saved to ${logPath} — prefer grepping the log over re-running.\n`,
    );
  } catch { /* best effort */ }
} catch { /* best effort */ }

process.exit(0);
