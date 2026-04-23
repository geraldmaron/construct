#!/usr/bin/env node
/**
 * lib/hooks/guard-bash.mjs — Guard bash hook — blocks dangerous shell commands from running unreviewed.
 *
 * Runs as PreToolUse on Bash. Scans the command against a blocklist of destructive patterns (rm -rf, force push to main, etc.) and exits 2 to block matches.
 *
 * @p95ms 5
 * @maxBlockingScope PreToolUse
 */
import { createInterface } from 'readline';

const BLOCK_PATTERNS = [
  {
    pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+\/(?:\s|$)/,
    reason: 'root filesystem deletion (rm -rf /)',
  },
  {
    pattern: /git\s+push\s+(?:--force|-f)\s+\S+\s+(?:main|master)\b/,
    reason: 'force push to main/master',
  },
  {
    pattern: /:\(\)\s*\{.*:\|.*:.*&.*\}\s*;.*:/,
    reason: 'fork bomb',
  },
  {
    pattern: /\bDROP\s+(?:TABLE|DATABASE)\b/i,
    reason: 'destructive DDL (DROP TABLE/DATABASE)',
  },
  {
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    reason: 'destructive DDL (TRUNCATE TABLE)',
  },
  {
    pattern: /sudo\s+rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+\/(?:etc|usr|var|boot)(?:\/|\s|$)/,
    reason: 'sudo deletion of critical system directory',
  },
];

const WARN_PATTERNS = [
  {
    pattern: /git\s+push\s+(?:--force|-f)(?!\s+\S+\s+(?:main|master)\b)/,
    reason: 'force push (not targeting main/master — proceed with caution)',
  },
  {
    pattern: /pip\s+install\s+--break-system-packages/,
    reason: '--break-system-packages may corrupt system Python environment',
  },
];

async function getCommand() {
  const fromEnv = process.env.TOOL_INPUT_COMMAND;
  if (fromEnv) return fromEnv;

  return new Promise((resolve) => {
    let data = '';
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => { data += line + '\n'; });
    rl.on('close', () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed?.tool_input?.command ?? parsed?.command ?? '');
      } catch {
        resolve('');
      }
    });
  });
}

const command = await getCommand();

if (!command) process.exit(0);

for (const { pattern, reason } of BLOCK_PATTERNS) {
  if (pattern.test(command)) {
    process.stderr.write(`[guard-bash] BLOCKED: ${reason}\nCommand: ${command.slice(0, 200)}\n`);
    process.exit(2);
  }
}

for (const { pattern, reason } of WARN_PATTERNS) {
  if (pattern.test(command)) {
    process.stderr.write(`[guard-bash] WARNING: ${reason}\nCommand: ${command.slice(0, 200)}\n`);
  }
}

process.exit(0);
