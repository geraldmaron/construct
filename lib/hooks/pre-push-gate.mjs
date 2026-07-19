#!/usr/bin/env node
/**
 * lib/hooks/pre-push-gate.mjs — PreToolUse / Bash
 *
 * Local pre-push gate, shrunk to what only the developer's machine can know.
 * Intercepts three command shapes:
 *   git push                refuses claude/* branches, blocks re-pushing the
 *                           exact SHA CI just rejected. No test/build/lint —
 *                           CI is the source of truth.
 *   gh pr create            lints the --body / --body-file against the PR
 *                           template policy before the PR is opened (CI can't
 *                           — the body doesn't exist until the PR is created).
 *   gh pr edit              same body lint when --body / --body-file is changed.
 *
 * Template-policy failures are warnings locally so a human can review and
 * correct editorial nits; CI still enforces the same rules on the resulting PR.
 *
 * Silent and instant when there's nothing to flag.
 *
 * No bypass mechanism. If a check fires wrong, the check is wrong — repair
 * the policy or the matcher; do not add a skip env var.
 *
 * @lifecycle PreToolUse
 * @matcher  Bash
 * @p95ms 5000
 * @maxBlockingScope PreToolUse
 * @exits 0 = pass | 2 = block tool call
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { logHookFailure } from './_lib/log.mjs';
import { emitRoleEvent } from '../roles/hook-emit.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'pre-push-gate', err, phase: 'parse' }); }

const echo = () => { process.stdout.write(JSON.stringify(input) + '\n'); process.exit(0); };

const command = input?.tool_input?.command || input?.command || '';
const isGitPush = /\bgit\s+push\b/.test(command);
const isGhPrCreate = /\bgh\s+pr\s+create\b/.test(command);
const isGhPrEdit = /\bgh\s+pr\s+edit\b/.test(command);

if (!isGitPush && !isGhPrCreate && !isGhPrEdit) { echo(); }

const cwd = input?.cwd || process.cwd();

const PROTECTED_BRANCHES = new Set(['main', 'staging', 'master']);

function currentBranch() {
  try {
    return execSync('git branch --show-current', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return ''; }
}

// gh pr create / gh pr edit body lint

if (isGhPrCreate || isGhPrEdit) {
  const { body, bodyFile } = extractGhPrBody(command);
  const hasArgs = body != null || bodyFile != null;

  if (!hasArgs) {
    process.stderr.write(
      `[pre-push-gate] ${isGhPrCreate ? 'gh pr create' : 'gh pr edit'} without --body/--body-file/-F — cannot lint PR body locally.\n` +
      `  CI will still enforce the template policy. To lint manually:\n` +
      `    construct lint:templates --body-file=<path>\n`,
    );
  } else {
    const scriptPath = findRepoFile(cwd, 'scripts/lint-commits-pr.mjs');
    if (!scriptPath) {
      process.stderr.write(`[pre-push-gate] could not locate scripts/lint-commits-pr.mjs from ${cwd}; skipping PR body lint\n`);
    } else {
      const env = { ...process.env };
      let tmpFile = null;
      try {
        if (bodyFile) {
          env.PR_BODY_FILE = resolve(cwd, bodyFile);
        } else if (body != null) {
          const dir = mkdtempSync(join(tmpdir(), 'construct-pr-lint-'));
          tmpFile = join(dir, 'body.md');
          writeFileSync(tmpFile, body);
          env.PR_BODY_FILE = tmpFile;
        }
        const result = spawnSync(process.execPath, [scriptPath], {
          cwd, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
        });
        const out = (result.stdout?.toString() || '') + (result.stderr?.toString() || '');
        if (result.status !== 0) {
          const severity = 'warn';
          const banner = '[pre-push-gate] PR body fails template policy (warning only):';
          process.stderr.write(`${banner}\n${out}\n`);
          emitRoleEvent({
            type: 'push_gate.warn',
            summary: `PR body fails template policy (${severity})`,
            hookInput: input,
            context: { command: isGhPrCreate ? 'gh pr create' : 'gh pr edit', detail: out.slice(0, 800) },
          });
          if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
        }
      } finally {
        if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
      }
    }
  }
  echo();
}

// git push: refuse agent-prefixed branches. Match the branch name(s) actually
// being pushed — the current branch plus any explicit refspec — anchored at the
// start, so a `.claude/agents` path argument anywhere in the command does not
// trip the gate.

const AGENT_BRANCH_PREFIX = /^(claude|cursor|copilot|codex|aider|devin)\//;
const pushTargets = [currentBranch()];
const pushArgs = (command.match(/\bgit\s+push\b([^|;&\n]*)/)?.[1] || '')
  .trim().split(/\s+/).filter((a) => a && !a.startsWith('-'));
for (const arg of pushArgs.slice(1)) pushTargets.push(arg.split(':').pop());

if (pushTargets.some((b) => b && AGENT_BRANCH_PREFIX.test(b))) {
  process.stderr.write(
    `[pre-push-gate] Refusing to push an agent-prefixed branch to remote (user policy).\n` +
    `  Use a non-agent branch name.\n`,
  );
  emitRoleEvent({
    type: 'push_gate.fail',
    summary: 'agent-prefixed branch push refused',
    hookInput: input,
    context: { command, pushTargets },
  });
  process.exit(2);
}

// Prior remote CI red-check: block only when HEAD == the SHA that failed
// (the developer is about to re-push the exact broken commit). If HEAD has
// moved past the failed SHA, those new commits may well BE the fix; let
// them push so CI can re-evaluate.

try {
  const branch = currentBranch();
  if (branch && !PROTECTED_BRANCHES.has(branch) && branch !== 'dev') {
    const json = execSync(
      `gh run list --branch=${JSON.stringify(branch)} --limit=1 --json conclusion,databaseId,url,headSha`,
      { cwd, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString().trim();
    if (json) {
      const [run] = JSON.parse(json);
      if (run?.conclusion === 'failure') {
        const headSha = execSync('git rev-parse HEAD', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
          .toString().trim();
        const runSha = run.headSha || '';
        const runUrl = run.url || `gh run view ${run.databaseId}`;
        if (runSha && headSha === runSha) {
          process.stderr.write(
            `[pre-push-gate] HEAD (${headSha.slice(0, 7)}) is the commit that failed CI on '${branch}'.\n` +
            `  Re-pushing the same SHA will fail again. Add a fix commit before pushing.\n` +
            `  Failed run: ${runUrl}\n`,
          );
          emitRoleEvent({
            type: 'push_gate.fail',
            summary: 'remote CI red on current HEAD — push blocked',
            hookInput: input,
            context: { branch, runId: run.databaseId, runUrl: run.url, headSha, runSha },
          });
          process.exit(2);
        }
        process.stderr.write(
          `[pre-push-gate] Note: last CI run on '${branch}' (${runSha.slice(0, 7) || 'unknown SHA'}) failed; HEAD (${headSha.slice(0, 7)}) is past it. Allowing push — CI will re-evaluate.\n` +
          `  Prior failure: ${runUrl}\n`,
        );
      }
    }
  }
} catch {}

echo();

// helpers

function extractGhPrBody(cmd) {
  let m = cmd.match(/--body-file[\s=]+(["']?)(\S+?)\1(?=\s|$)/);
  if (m) return { bodyFile: m[2] };
  m = cmd.match(/(?:^|\s)-F[\s=]+(["']?)(\S+?)\1(?=\s|$)/);
  if (m) return { bodyFile: m[2] };
  m = cmd.match(/--body[\s=]+"((?:\\.|[^"\\])*)"/s);
  if (m) return { body: m[1].replace(/\\(["\\])/g, '$1') };
  m = cmd.match(/--body[\s=]+'([^']*)'/s);
  if (m) return { body: m[1] };
  return {};
}

function findRepoFile(startDir, relPath) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, relPath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
