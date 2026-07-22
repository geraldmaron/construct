#!/usr/bin/env node
/**
 * lib/hooks/guard-bash.mjs — Guard bash hook — blocks dangerous shell commands from running unreviewed.
 *
 * Runs as PreToolUse on Bash. Scans the command against a blocklist of destructive patterns (rm -rf, force push to main, etc.) and exits 2 to block matches.
 *
 * Budget covers the role-fence path below — doctorRoot lookup, last-agent file reads, and the lazy manifest/fence/approval imports — which the original 5ms target predated; the nightly bench (variance-heavy CI lane) measured ~17-19ms marginal, so the budget reflects that real cost with the ×2 gate tolerance still catching a true regression.
 *
 * @p95ms 15
 * @maxBlockingScope PreToolUse
 *
 * @lifecycle PreToolUse
 * @matcher  Bash
 * @exits 0 = pass | 2 = block tool call
 */
import { createInterface } from 'readline';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logHookFailure } from './_lib/log.mjs';
import { doctorRoot } from '../config/xdg.mjs';

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

// agent_id is Claude Code's own subagent marker: present only when this
// invocation is running inside a subagent's own tool call, absent for
// main-thread (orchestrator) calls. It is the actor-identity signal the
// role-fence check below uses to prove WHO is issuing THIS command, instead
// of trusting how recently some worker profile was dispatched elsewhere (construct-7164).

async function getInvocation() {
  const fromEnv = process.env.TOOL_INPUT_COMMAND;
  if (fromEnv) return { command: fromEnv, agentId: null };

  return new Promise((resolve) => {
    let data = '';
    const rl = createInterface({ input: process.stdin });
    rl.on('line', (line) => { data += line + '\n'; });
    rl.on('close', () => {
      try {
        const parsed = JSON.parse(data);
        resolve({
          command: parsed?.tool_input?.command ?? parsed?.command ?? '',
          agentId: parsed?.agent_id ?? null,
        });
      } catch (err) {
        logHookFailure({ hook: 'guard-bash', err, phase: 'parse' });
        resolve({ command: '', agentId: null });
      }
    });
  });
}

const { command, agentId: currentAgentId } = await getInvocation();

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

// Role-fence check: evaluate the command against a Worker Profile's fence, but only
// when the CURRENT invocation's actor identity is verifiably that worker profile —
// recency of a past dispatch is not proof of who is issuing THIS command
// (construct-7164: an orchestrator's or a different subagent's own bash
// calls were getting fenced by a worker profile dispatched minutes earlier
// elsewhere). Two identity signals are trusted: CONSTRUCT_AGENT_ID, an
// explicit self-declaration some hosts set before invoking commands as a
// given Worker Profile; and agent_id, Claude Code's own per-subagent marker, which
// is guaranteed absent for main-thread calls. The shared last-agent.json
// (no identity attached) can only corroborate a dispatch already proven by
// agent_id — it is never sufficient on its own. git commit/push are always
// commit/push actions; bd ... maps to allowedCommands prefix-match;
// everything else is the bash action.

const FENCE_WINDOW_MS = 5 * 60 * 1000;

if (process.env.CONSTRUCT_ROLES !== 'off') {
  try {
    const constructDir = doctorRoot();
    const id = String(process.env.CONSTRUCT_AGENT_ID || '').replace(/^cx-/, '');
    let agentData = null;

    // Self-declared identity: the per-agent file is keyed by the same id the
    // current invocation is claiming, so this match is identity-comparable
    // by construction.
    if (id) {
      const perAgentPath = join(constructDir, `last-agent-${id.replace(/[^a-z0-9._-]/gi, '_')}.json`);
      if (existsSync(perAgentPath)) {
        agentData = JSON.parse(readFileSync(perAgentPath, 'utf8'));
      }
    }
    // No self-declared id: only trust the shared dispatch record when the
    // CURRENT invocation's own agent_id matches the one recorded at dispatch
    // time, proving this is the SAME subagent call rather than a different
    // actor riding a fresh timestamp.
    if (!agentData && currentAgentId) {
      const sharedPath = join(constructDir, 'last-agent.json');
      if (existsSync(sharedPath)) {
        const shared = JSON.parse(readFileSync(sharedPath, 'utf8'));
        if (shared?.agentId && shared.agentId === currentAgentId) agentData = shared;
      }
    }

    if (agentData) {
      const lastTs = agentData?.ts ? Date.parse(agentData.ts) : 0;
      const fresh = lastTs && (Date.now() - lastTs) < FENCE_WINDOW_MS;
      const workerProfileId = id || String(agentData?.agent || '').replace(/^cx-/, '');
      if (fresh && workerProfileId) {
        const { isOnboarded } = await import('../roles/manifest.mjs');
        if (isOnboarded(workerProfileId)) {
          const { checkAction } = await import('../roles/fence.mjs');
          const trimmed = command.trim();
          let verdict;
          if (/^git\s+commit\b/.test(trimmed)) {
            verdict = checkAction({ workerProfileId, action: 'commit', target: '' });
          } else if (/^git\s+push\b/.test(trimmed)) {
            verdict = checkAction({ workerProfileId, action: 'push', target: '' });
          } else {
            verdict = checkAction({ workerProfileId, action: 'bash', target: trimmed });
          }
          if (!verdict.allowed && verdict.reason === 'outside-fence') {
            const allowedList = await (async () => {
              try { const { loadManifest } = await import('../roles/manifest.mjs'); const m = loadManifest(workerProfileId); return m?.fence?.allowedCommands?.join(', ') || 'see role-manifests.json'; } catch { return 'see role-manifests.json'; }
            })();
            process.stderr.write(
              `[fence] ${workerProfileId} cannot run this command — outside declared fence.\n` +
              `Command: ${trimmed.slice(0, 200)}\n` +
              `Allowed commands: ${allowedList}\n` +
              `To bypass: set CONSTRUCT_ROLES=off as a real environment variable before starting this session (this hook runs as a separate process, so an inline "CONSTRUCT_ROLES=off <command>" prefix on the blocked command never reaches it).\n`
            );
            process.exit(2);
          }
          if (!verdict.allowed && verdict.approval) {
            process.stderr.write(
              `[fence] ${workerProfileId} running this requires user approval (${verdict.reason}).\n` +
              `Command: ${trimmed.slice(0, 200)}\n`
            );
            const { recordApprovalNotice } = await import('../writes/authority-ledger.mjs');
            const actionLabel = /^git\s+commit\b/.test(trimmed) ? 'commit' : /^git\s+push\b/.test(trimmed) ? 'push' : 'bash';
            await recordApprovalNotice({ workerProfileId, action: actionLabel, target: trimmed, reason: verdict.reason || 'needs-approval' });
          }
        }
      }
    }
  } catch { /* best effort */ }
}

process.exit(0);
