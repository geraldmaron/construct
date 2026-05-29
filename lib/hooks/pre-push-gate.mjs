#!/usr/bin/env node
/**
 * pre-push-gate.mjs — PreToolUse / Bash
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
 * Design intent. Earlier revisions of this hook re-ran the entire CI matrix
 * locally on every push (npm test, build, audit, evals, every lint). Wall
 * time hit ~65s, and the duplication trained everyone to use
 * `CONSTRUCT_SKIP_PREPUSH=1` as a daily escape hatch. A gate that gets
 * skipped is not a gate. The fix is to make pre-push fast and narrow so
 * it's trustworthy, and to push the heavy work to CI (which has clean
 * state, runs in parallel matrices, and is the merge gate of record).
 *
 * Template-policy severity for PR body lint is conditional: a hard block
 * (exit 2) when a specialist sub-agent is active; a warning otherwise so a
 * human driving the session can override editorial nits. CI still enforces
 * the same rules on the resulting PR.
 *
 * Silent and instant when there's nothing to flag.
 *
 * Bypasses. Each works either as a parent-process env var OR as an inline
 * command-line prefix on the bash command Claude Code is about to run —
 * `CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD` works inside Claude Code
 * even though Claude Code's parent env doesn't carry the var.
 *   CONSTRUCT_SKIP_PREPUSH=1        skip the prior-CI re-push check
 *   CONSTRUCT_ALLOW_CLAUDE_PUSH=1   allow pushing a claude/* branch
 *   CONSTRUCT_SKIP_PR_LINT=1        skip the gh pr body lint
 *
 * Bypasses on protected branches (main, staging, master) are refused
 * unconditionally — those branches go through PR + CI and the hook will
 * not honor an override for direct pushes against them. Every honored
 * bypass is appended to ~/.construct/audit/prepush-bypass.log so
 * `construct doctor` can surface frequent usage as a signal that
 * something upstream is broken instead of normalizing the bypass.
 *
 * @p95ms 5000
 * @maxBlockingScope PreToolUse
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, appendFileSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { tmpdir, homedir } from 'os';
import { logHookFailure } from './_lib/log.mjs';
import { isSpecialistAgentActive } from './_lib/specialist-agent.mjs';
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

// PreToolUse hooks run in Claude Code's process before bash executes the
// command, so inline env-var prefixes like `CONSTRUCT_SKIP_PREPUSH=1 git push`
// never reach process.env. Parse them out of the command string and treat
// them as if they were set in the env — matches the documented escape hatch.

const BYPASS_VARS = new Set(['CONSTRUCT_SKIP_PREPUSH', 'CONSTRUCT_ALLOW_CLAUDE_PUSH', 'CONSTRUCT_SKIP_PR_LINT']);
const PROTECTED_BRANCHES = new Set(['main', 'staging', 'master']);
const inlineEnv = parseInlineEnv(command);

function bypass(name) {
  return inlineEnv[name] === '1' || process.env[name] === '1';
}
function bypassSource(name) {
  return inlineEnv[name] === '1' ? 'inline' : 'env';
}
function parseInlineEnv(cmd) {
  const out = {};
  const re = /(^|\s)([A-Z_][A-Z0-9_]*)=(\S+)/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    // Stop at the first whitespace-separated token that isn't a NAME=VALUE
    // assignment — env-var prefixes only apply before the executable.
    const between = cmd.slice(lastIndex, m.index).trim();
    if (between && !/^[A-Z_][A-Z0-9_]*=\S+$/.test(between)) break;
    if (BYPASS_VARS.has(m[2])) out[m[2]] = m[3];
    lastIndex = re.lastIndex;
  }
  return out;
}

function currentBranch() {
  try {
    return execSync('git branch --show-current', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return ''; }
}

// Append every honored bypass to a JSONL audit log. Lets `construct doctor`
// detect "this developer is bypassing daily, the gate is probably wrong"
// instead of letting the bypass quietly become the default.

function logBypass(name) {
  try {
    const dir = join(homedir(), '.construct', 'audit');
    mkdirSync(dir, { recursive: true });
    let head = '';
    try {
      head = execSync('git rev-parse HEAD', { cwd, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim().slice(0, 12);
    } catch {}
    const entry = {
      ts: new Date().toISOString(),
      var: name,
      source: bypassSource(name),
      branch: currentBranch(),
      head,
      cmd: command.length > 200 ? command.slice(0, 200) + '…' : command,
    };
    appendFileSync(join(dir, 'prepush-bypass.log'), JSON.stringify(entry) + '\n');
  } catch { /* audit log is best-effort */ }
}

// Bypasses are for feature branches. main + staging + master go through
// PR + CI; honoring a SKIP here would let unreviewed code reach the
// integration trunk or release branch. Refuse with a clear message.

function refuseBypassOnProtected(name) {
  const branch = currentBranch();
  if (PROTECTED_BRANCHES.has(branch)) {
    process.stderr.write(
      `[pre-push-gate] ${name}=1 refused on protected branch '${branch}'.\n` +
      `  Open a PR from a feature branch; CI is the source of truth here.\n`,
    );
    emitRoleEvent({
      type: 'push_gate.fail',
      summary: `${name}=1 refused on protected branch ${branch}`,
      hookInput: input,
      context: { branch, var: name },
    });
    process.exit(2);
  }
}

// ── gh pr create / gh pr edit body lint ──────────────────────────────────────

if ((isGhPrCreate || isGhPrEdit) && !bypass('CONSTRUCT_SKIP_PR_LINT')) {
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
          const agentActive = isSpecialistAgentActive();
          const severity = agentActive ? 'fail' : 'warn';
          const banner = agentActive
            ? '[pre-push-gate] PR body fails template policy (specialist agent active — blocking):'
            : '[pre-push-gate] PR body fails template policy (no specialist agent active — warning only):';
          process.stderr.write(`${banner}\n${out}\n`);
          process.stderr.write(`Override: CONSTRUCT_SKIP_PR_LINT=1 <command>\n`);
          emitRoleEvent({
            type: agentActive ? 'push_gate.fail' : 'push_gate.warn',
            summary: `PR body fails template policy (${severity})`,
            hookInput: input,
            context: { command: isGhPrCreate ? 'gh pr create' : 'gh pr edit', detail: out.slice(0, 800), agentActive },
          });
          if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
          if (agentActive) process.exit(2);
        }
      } finally {
        if (tmpFile) try { rmSync(dirname(tmpFile), { recursive: true, force: true }); } catch {}
      }
    }
  }
  echo();
}

if (bypass('CONSTRUCT_SKIP_PR_LINT') && (isGhPrCreate || isGhPrEdit)) {
  // Body-lint was suppressed by env. Log + pass through.

  logBypass('CONSTRUCT_SKIP_PR_LINT');
  echo();
}

// ── git push branch checks ───────────────────────────────────────────────────

if (bypass('CONSTRUCT_SKIP_PREPUSH')) {
  refuseBypassOnProtected('CONSTRUCT_SKIP_PREPUSH');
  logBypass('CONSTRUCT_SKIP_PREPUSH');
  echo();
}

if (/\bclaude\//.test(command) && !bypass('CONSTRUCT_ALLOW_CLAUDE_PUSH')) {
  process.stderr.write(
    `[pre-push-gate] Refusing to push a claude/* branch to remote (user policy).\n` +
    `  Use a non-agent branch name, or override with CONSTRUCT_ALLOW_CLAUDE_PUSH=1 git push ...\n`,
  );
  emitRoleEvent({
    type: 'push_gate.fail',
    summary: 'claude/* branch push refused',
    hookInput: input,
    context: { command },
  });
  process.exit(2);
}

if (bypass('CONSTRUCT_ALLOW_CLAUDE_PUSH')) {
  refuseBypassOnProtected('CONSTRUCT_ALLOW_CLAUDE_PUSH');
  logBypass('CONSTRUCT_ALLOW_CLAUDE_PUSH');
}

// Prior remote CI red-check: block only when HEAD == the SHA that failed
// (i.e. the developer is about to re-push the exact broken commit). If
// HEAD has moved past the failed SHA, those new commits may well BE the
// fix — blocking them creates a doom loop where the fix can't land
// without an env-var override, which trains everyone to ignore the gate.
// Print a non-blocking notice instead so the author still sees prior red.

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
            `  Failed run: ${runUrl}\n` +
            `  Override (if you really mean it): CONSTRUCT_SKIP_PREPUSH=1 git push ...\n`,
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

// ── helpers ──────────────────────────────────────────────────────────────────

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
