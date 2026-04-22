#!/usr/bin/env node
/**
 * lib/hooks/commit-approval.mjs — blocks unapproved mutating git operations.
 *
 * Runs as PreToolUse on Bash. Reads the command; if it mutates repo history
 * (git commit, git push, gh pr merge), looks up an approval marker written
 * by `construct approve <action>` via lib/approve.mjs. Without a valid
 * marker the hook exits 2 and tells the user exactly how to approve.
 *
 * Marker-scope match:
 *   - If the marker has `branch` set, it must equal the current branch
 *     (git rev-parse --abbrev-ref HEAD) for the operation to be allowed.
 *   - Consumed on approval — remainingCount decremented; marker deleted at 0.
 *
 * Bypass (emergency only): set CONSTRUCT_APPROVAL_BYPASS=1. Logged to the
 * audit trail the next time an edit fires.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { consumeMarker, readMarker } from '../approve.mjs';

// Anchor on real shell-command boundaries — start of string or after a
// command separator (;, &&, ||, |, newline). This avoids false positives
// when 'git commit' appears inside a quoted string (echo/printf payload).
const CMD_BOUNDARY = String.raw`(?:^|[;\n]|&&|\|\|?)\s*`;
const PATTERNS = [
  { action: 'commit', regex: new RegExp(CMD_BOUNDARY + String.raw`git\s+commit(?:\s|$)`) },
  { action: 'push',   regex: new RegExp(CMD_BOUNDARY + String.raw`git\s+push(?:\s|$)`) },
  { action: 'merge',  regex: new RegExp(CMD_BOUNDARY + String.raw`gh\s+pr\s+merge(?:\s|$)`) },
];

// Strip quoted string content before matching — avoids catching 'git commit'
// inside echoed JSON or printf payloads.
function stripQuoted(cmd) {
  return cmd
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function detectAction(command) {
  const cleaned = stripQuoted(command);
  for (const { action, regex } of PATTERNS) {
    if (regex.test(cleaned)) return action;
  }
  return null;
}

function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

if ((input?.tool_name || '') !== 'Bash') process.exit(0);

const command = String(input?.tool_input?.command || '');
if (!command) process.exit(0);

const action = detectAction(command);
if (!action) process.exit(0);

if (process.env.CONSTRUCT_APPROVAL_BYPASS === '1') {
  process.stderr.write(`[commit-approval] BYPASS: ${action} allowed via CONSTRUCT_APPROVAL_BYPASS=1. This is logged.\n`);
  process.exit(0);
}

const marker = readMarker(action);
if (!marker) {
  process.stderr.write(
    `[commit-approval] BLOCKED: ${action} requires explicit user approval.\n` +
    `  Ask the user to run: construct approve ${action}\n` +
    `  (Default TTL 10 minutes, one operation. See construct approve --help.)\n` +
    `  Agents must NOT run \`construct approve\` themselves — that is the user's decision.\n`,
  );
  process.exit(2);
}

const cwd = input?.cwd || process.cwd();
const branch = currentBranch(cwd);

if (marker.branch && branch && marker.branch !== branch) {
  process.stderr.write(
    `[commit-approval] BLOCKED: approval is scoped to branch "${marker.branch}" but current branch is "${branch}".\n` +
    `  Either switch branches or ask the user to re-run: construct approve ${action} --branch ${branch}\n`,
  );
  process.exit(2);
}

consumeMarker(action);
process.stderr.write(
  `[commit-approval] ${action} approved (branch: ${branch || 'unknown'}). Marker consumed.\n`,
);
process.exit(0);
