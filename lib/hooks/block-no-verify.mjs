#!/usr/bin/env node
/**
 * lib/hooks/block-no-verify.mjs — refuse `git commit/push/merge --no-verify`.
 *
 * Runs as PreToolUse on Bash. Pre-commit / pre-push hooks exist to keep red
 * code from landing; --no-verify bypasses them entirely. If a hook is
 * failing, fix the underlying issue.
 *
 * Vendored from block-no-verify@1.1.2 (Elastic-2.0) to drop the per-Bash-call
 * npx cold-start tax and remove the third-party dependency for ~30 lines of
 * logic that we already maintain comment + audit policy for.
 *
 * @p95ms 5
 * @maxBlockingScope PreToolUse
 */
import { readFileSync } from 'node:fs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const command = String(input?.tool_input?.command || '').trim();
if (!command) process.exit(0);

const isGitCommit = /^git\s+commit\b/.test(command);
const isGitPushMergeEtc = /^git\s+(push|merge|am|rebase|cherry-pick|notes|revert|tag)\b/.test(command);

if (!isGitCommit && !isGitPushMergeEtc) process.exit(0);

const hasLongFlag = /(?:^|\s)--no-verify(?:\s|=|$)/.test(command);
const hasShortN = isGitCommit && /(?:^|\s)-n(?:\s|$)/.test(command);

if (hasLongFlag || hasShortN) {
  process.stderr.write(
    `[block-no-verify] BLOCKED: --no-verify bypasses pre-commit / pre-push hooks.\n` +
    `Command: ${command.slice(0, 200)}\n` +
    `If a hook is failing, fix the underlying issue instead of skipping it.\n`,
  );
  process.exit(2);
}

process.exit(0);
