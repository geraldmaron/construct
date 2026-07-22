/**
 * lib/lint-pr-cli.mjs — local pre-flight for the CI `template policy` gate.
 *
 * Backs `construct lint:pr`. CI's template-policy job (scripts/lint-commits-pr.mjs,
 * run via `npm run lint:templates`) reads PR_BODY/PR_BASE_SHA/PR_BASE_REF/PR_AUTHOR
 * from GitHub Actions env vars that only exist once a PR is open. This module
 * resolves the same inputs locally — from an explicit --file, from `gh pr view`
 * when the current branch already has an open PR, or (failing both) prints an
 * honest skip notice rather than faking a pass — then calls the real
 * lintCommits()/lintPrBody() so the two entry points can never drift on logic.
 *
 * The `runner` param is the shell-out seam: tests inject a fake to cover gh
 * availability/auth/no-PR branches without spawning a real `gh` process.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function defaultRunner(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, ...opts });
}

function resolveFlag(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] !== undefined) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

// Three separate shell-outs (not one `gh pr view` wrapped in a single try)
// so a skip notice can name the actual cause — not installed, not
// authenticated, or authenticated with no open PR for this branch.

function tryGhPrView({ cwd, runner }) {
  try {
    runner('gh --version', { cwd });
  } catch {
    return { available: false, reason: 'gh CLI is not installed' };
  }
  try {
    runner('gh auth status', { cwd });
  } catch {
    return { available: false, reason: 'gh CLI is not authenticated (run `gh auth login`)' };
  }
  try {
    const raw = runner('gh pr view --json body,baseRefName,author', { cwd });
    return { available: true, pr: JSON.parse(raw) };
  } catch {
    return { available: true, pr: null };
  }
}

export function resolvePrContext(args, { cwd = process.cwd(), runner = defaultRunner } = {}) {
  const fileArg = resolveFlag(args, 'file');
  const baseArg = resolveFlag(args, 'base');

  if (fileArg) {
    const resolved = path.isAbsolute(fileArg) ? fileArg : path.join(cwd, fileArg);
    if (!fs.existsSync(resolved)) {
      return { status: 'error', message: `--file path does not exist: ${resolved}` };
    }
    return { status: 'file', bodyFile: resolved, baseRef: baseArg };
  }

  const gh = tryGhPrView({ cwd, runner });

  if (gh.available && gh.pr) {
    return {
      status: 'gh',
      body: gh.pr.body ?? '',
      baseRef: baseArg || gh.pr.baseRefName,
      author: gh.pr.author?.login,
    };
  }

  if (gh.available && !gh.pr) {
    return { status: 'no-pr', baseRef: baseArg };
  }

  return { status: 'gh-unavailable', reason: gh.reason, baseRef: baseArg };
}

function skipMessage(ctx) {
  if (ctx.status === 'no-pr') {
    return 'no open PR found for this branch (`gh pr view` found nothing).\n'
      + '  Use --file <path> to check a draft PR body before opening the PR.';
  }
  if (ctx.status === 'gh-unavailable') {
    return `${ctx.reason}, and no --file was given.\n`
      + '  Use --file <path> to check a draft PR body, or install/auth gh and rerun.';
  }
  return null;
}

// PR_BASE_SHA is left unset here on purpose — gh only surfaces the base
// *ref*, not a commit SHA, and getRange() in scripts/lint-commits-pr.mjs
// already falls back cleanly from PR_BASE_REF to the branch's upstream to
// origin/main when no SHA is given.

export async function runLintPrCli(args, { cwd = process.cwd(), runner = defaultRunner } = {}) {
  const { lintCommits, lintPrBody, reportTemplatePolicy } = await import('../scripts/lint-commits-pr.mjs');
  const ctx = resolvePrContext(args, { cwd, runner });

  if (ctx.status === 'error') {
    console.error(ctx.message);
    return 1;
  }

  const saved = {
    PR_BODY: process.env.PR_BODY,
    PR_BODY_FILE: process.env.PR_BODY_FILE,
    PR_BASE_SHA: process.env.PR_BASE_SHA,
    PR_BASE_REF: process.env.PR_BASE_REF,
    PR_AUTHOR: process.env.PR_AUTHOR,
  };

  try {
    delete process.env.PR_BODY;
    delete process.env.PR_BODY_FILE;
    delete process.env.PR_AUTHOR;
    if (ctx.baseRef) process.env.PR_BASE_REF = ctx.baseRef;
    else delete process.env.PR_BASE_REF;
    // PR_BASE_SHA is deliberately left as-is: neither --file nor `gh pr view`
    // produce a commit SHA, and clobbering an ambient value here would break
    // getRange()'s own SHA-first precedence for no reason.

    if (ctx.status === 'file') {
      process.env.PR_BODY_FILE = ctx.bodyFile;
    } else if (ctx.status === 'gh') {
      process.env.PR_BODY = ctx.body;
      if (ctx.author) process.env.PR_AUTHOR = ctx.author;
    }

    const checkedBody = ctx.status === 'file' || ctx.status === 'gh';
    const commitViolations = lintCommits();
    const prViolations = checkedBody ? lintPrBody() : [];
    const all = [...commitViolations, ...prViolations];
    const notice = checkedBody ? null : skipMessage(ctx);

    if (notice) console.log(`PR-body heading check skipped: ${notice}`);

    if (all.length === 0 && !checkedBody) {
      console.log('Commit-subject check: clean. (PR-body heading check was skipped — see above.)');
      return 0;
    }

    return reportTemplatePolicy(all);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
