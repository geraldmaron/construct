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
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logHookFailure } from './_lib/log.mjs';

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
      } catch (err) {
        logHookFailure({ hook: 'guard-bash', err, phase: 'parse' });
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

// Role-fence check: if the most recently dispatched persona is one we manage
// and the dispatch is fresh, evaluate the command against the persona's
// fence. git commit/push are always commit/push actions; bd ... maps to
// allowedCommands prefix-match; everything else is the bash action.

if (process.env.CONSTRUCT_ROLES !== 'off') {
  try {
    const lastAgentPath = join(homedir(), '.cx', 'last-agent.json');
    if (existsSync(lastAgentPath)) {
      const last = JSON.parse(readFileSync(lastAgentPath, 'utf8'));
      const lastTs = last?.ts ? Date.parse(last.ts) : 0;
      const fresh = lastTs && (Date.now() - lastTs) < 10 * 60 * 1000;
      const id = String(last?.agent || '').replace(/^cx-/, '');
      if (fresh && id) {
        const { isOnboarded } = await import('../roles/manifest.mjs');
        if (isOnboarded(id)) {
          const { checkAction } = await import('../roles/fence.mjs');
          const trimmed = command.trim();
          let verdict;
          if (/^git\s+commit\b/.test(trimmed)) {
            verdict = checkAction({ personaId: id, action: 'commit', target: '' });
          } else if (/^git\s+push\b/.test(trimmed)) {
            verdict = checkAction({ personaId: id, action: 'push', target: '' });
          } else {
            verdict = checkAction({ personaId: id, action: 'bash', target: trimmed });
          }
          if (!verdict.allowed && verdict.reason === 'outside-fence') {
            process.stderr.write(
              `[fence] cx-${id} cannot run this command — outside declared fence.\n` +
              `Command: ${trimmed.slice(0, 200)}\n` +
              `Allowed commands prefix list: see agents/role-manifests.json → ${id} → fence.allowedCommands.\n`
            );
            process.exit(2);
          }
          if (!verdict.allowed && verdict.approval) {
            process.stderr.write(
              `[fence] cx-${id} running this requires user approval (${verdict.reason}).\n` +
              `Command: ${trimmed.slice(0, 200)}\n`
            );
          }
        }
      }
    }
  } catch { /* best effort */ }
}

process.exit(0);
