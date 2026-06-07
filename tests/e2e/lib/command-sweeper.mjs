/**
 * tests/e2e/lib/command-sweeper.mjs — Tier-2 command-sweep engine.
 *
 * Reads lib/cli-commands.mjs (the single source of truth) and produces a
 * safe-default invocation for every public and internal command, runs it inside
 * a scenario's sterile env, and captures one evidence row per command: exit
 * code, stdout/stderr length, files created/modified (diffed against a
 * pre-state snapshot), and whether `--help` resolves.
 *
 * Why a policy table instead of scraping option metadata: only a handful of
 * commands self-declare `--json` / `--dry-run` / `--yes` in their `options`
 * array, yet many more support those flags. Scraping would under-invoke. So the
 * sweeper defaults to a conservative classification and carries an explicit
 * override table for commands that (a) block (service daemons), (b) mutate
 * machine state, or (c) need a specific safe argv. Every command lands in
 * exactly one mode, and the mode + reason are recorded in the row so the report
 * shows *why* a command was run, help-probed, or skipped.
 *
 * Verdicts live elsewhere — capture only happens here; owner-verdict.mjs and
 * the runner turn evidence into verdicts.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CLI_COMMANDS } from '../../../lib/cli-commands.mjs';

export const SWEEP_MODE = Object.freeze({
  RUN: 'run',
  HELP_ONLY: 'help-only',
  SKIP: 'skip',
});

// Commands that would block, daemonize, mutate machine/global state, or require
// network/services the sterile env does not provide. Each is help-probed for doc
// parity but never executed live in the sweep. The reason is surfaced in the row.

export const EXECUTION_OVERRIDES = {
  dev: { mode: SWEEP_MODE.HELP_ONLY, reason: 'starts long-lived services (blocks)' },
  up: { mode: SWEEP_MODE.HELP_ONLY, reason: 'starts long-lived services (blocks)' },
  dashboard: { mode: SWEEP_MODE.HELP_ONLY, reason: 'starts the dashboard daemon (blocks)' },
  down: { mode: SWEEP_MODE.HELP_ONLY, reason: 'tears down shared services' },
  stop: { mode: SWEEP_MODE.HELP_ONLY, reason: 'stops shared services' },
  install: { mode: SWEEP_MODE.HELP_ONLY, reason: 'mutates machine scope (covered by Tier 1)' },
  uninstall: { mode: SWEEP_MODE.HELP_ONLY, reason: 'reverses install — destructive in sweep' },
  init: { mode: SWEEP_MODE.HELP_ONLY, reason: 'scaffolds the project (covered by Tier 1)' },
  'init:update': { mode: SWEEP_MODE.HELP_ONLY, reason: 'rewrites project scaffolding' },
  migrate: { mode: SWEEP_MODE.HELP_ONLY, reason: 'applies schema migrations' },
  hook: { mode: SWEEP_MODE.HELP_ONLY, reason: 'dispatch-only entrypoint; driven by Tier 4' },
  ask: { mode: SWEEP_MODE.HELP_ONLY, reason: 'real LLM call — driven by Tier 3, not the sweep' },
};

// Flags that make a command non-interactive and read-only-ish where it supports
// them. The sweeper appends the first supported flag it can detect, defaulting to
// nothing (bare invocation under a hard timeout with stdin closed).

const SAFE_FLAG_PREFERENCE = ['--json', '--dry-run'];

export function enumerateCommands() {
  return {
    public: CLI_COMMANDS.filter((c) => !c.internal),
    internal: CLI_COMMANDS.filter((c) => c.internal),
    all: [...CLI_COMMANDS],
  };
}

function declaresFlag(cmd, flag) {
  return (cmd.options || []).some((o) => (o.flag || '').startsWith(flag));
}

// Decide how a command is invoked. Override table wins; otherwise prefer a safe
// flag if declared, else a bare invocation. The returned plan is recorded so the
// report can show the exact argv that produced the row.

export function planInvocation(cmd) {
  const override = EXECUTION_OVERRIDES[cmd.name];
  if (override) return { command: cmd.name, mode: override.mode, args: [], reason: override.reason };

  const safeFlag = SAFE_FLAG_PREFERENCE.find((f) => declaresFlag(cmd, f));
  return {
    command: cmd.name,
    mode: SWEEP_MODE.RUN,
    args: safeFlag ? [safeFlag] : [],
    reason: safeFlag ? `safe flag ${safeFlag}` : 'bare invocation under timeout',
  };
}

// A tree snapshot is a flat map of repo-relative path -> mtimeMs, the basis for
// detecting which files a command creates or modifies. Bounded to the scenario
// project dir so a command touching ~/.cx is not mis-attributed.

export function snapshotTree(rootDir) {
  const out = new Map();
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try { out.set(relative(rootDir, full), statSync(full).mtimeMs); } catch { /* race */ }
      }
    }
  };
  walk(rootDir);
  return out;
}

export function diffTree(before, after) {
  const created = [];
  const modified = [];
  for (const [path, mtime] of after) {
    if (!before.has(path)) created.push(path);
    else if (before.get(path) !== mtime) modified.push(path);
  }
  return { created, modified };
}

// Run a single command's help probe — used for doc parity in every mode.

export function probeHelp({ launcher, cmd, cwd, env, timeoutMs = 20_000 }) {
  const res = spawnSync(process.execPath, [launcher, cmd.name, '--help'], {
    cwd, env, encoding: 'utf8', timeout: timeoutMs, input: '',
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
  };
}

// Execute one command per its plan and capture an evidence row. Pure capture —
// no verdict. `launcher` is the path to .construct/run.mjs in the scenario env.

export function sweepOne({ launcher, cmd, cwd, env, projectDir, timeoutMs = 30_000 }) {
  const plan = planInvocation(cmd);
  const help = probeHelp({ launcher, cmd, cwd, env });

  const row = {
    command: cmd.name,
    internal: !!cmd.internal,
    plan,
    help: { status: help.status, stdoutLen: help.stdout.length, timedOut: help.timedOut },
    exec: null,
  };

  if (plan.mode !== SWEEP_MODE.RUN) return row;

  const before = snapshotTree(projectDir);
  const res = spawnSync(process.execPath, [launcher, cmd.name, ...plan.args], {
    cwd, env, encoding: 'utf8', timeout: timeoutMs, input: '',
  });
  const after = snapshotTree(projectDir);
  const { created, modified } = diffTree(before, after);

  row.exec = {
    argv: [cmd.name, ...plan.args],
    status: res.status,
    stdoutLen: (res.stdout || '').length,
    stderrLen: (res.stderr || '').length,
    timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
    filesCreated: created,
    filesModified: modified,
  };
  return row;
}
