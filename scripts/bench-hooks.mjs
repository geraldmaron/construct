#!/usr/bin/env node
/**
 * scripts/bench-hooks.mjs — measure per-hook p95 wall time against declared
 * `@p95ms` budgets (ADR-0029).
 *
 * For each `lib/hooks/*.mjs` carrying an `@lifecycle <event>` header and a
 * `@p95ms <N>` budget, the harness spawns the hook N times with a synthetic
 * stdin matching its event shape and records wall time per run. Output is a
 * JSON report at `.cx/bench/hooks-<ISO date>.json` with one entry per hook:
 * declared budget, median, p95, max, count, exits, lifecycle, status.
 *
 * The `@p95ms` budget is the hook's OWN marginal cost, not the Node interpreter
 * startup it shares with every other hook (~30ms cold, and it drifts with the
 * runner's Node version — Node 20→24 alone pushed every sub-30ms budget red).
 * So the harness first measures a bare Node+stdin baseline and judges each hook
 * on `p95 - baseline`: status is `pass` when that marginal p95 <= budget ×
 * tolerance, else `fail`. Tolerance defaults to 2× per ADR-0029.
 *
 * Hooks marked `@unwired` are skipped — they are not registered in
 * `platforms/claude/settings.template.json` and would never run in
 * production. Hooks whose event shape requires live Construct services
 * (Postgres, gh CLI, network) measure their fast-path return; the budget
 * applies to whichever code path the hook actually takes given the test
 * environment.
 *
 * Usage:
 *   node scripts/bench-hooks.mjs            # default N=20, write JSON report
 *   node scripts/bench-hooks.mjs --runs=10  # override sample size
 *   node scripts/bench-hooks.mjs --hook=ci-status-check  # one hook
 *   node scripts/bench-hooks.mjs --json     # stdout JSON only, no report file
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { configPath } from '../lib/config-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HOOKS_DIR = path.join(ROOT, 'lib', 'hooks');
const REPORT_DIR = configPath(ROOT, 'bench');

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.slice(2), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);

const RUNS = Number(args.runs ?? 20);
const TOLERANCE = Number(args.tolerance ?? 2);
const ONLY_HOOK = args.hook || null;
const JSON_ONLY = args.json === 'true';
const TIMEOUT_MS = Number(args.timeout ?? 30000);

function parseHeader(file) {
  const src = readFileSync(file, 'utf8');
  const lifecycle = src.match(/@lifecycle\s+(\S+)/)?.[1] ?? null;
  const matcher = src.match(/@matcher\s+(\S+)/)?.[1] ?? null;
  const p95Raw = src.match(/@p95ms\s+([0-9_]+)/)?.[1] ?? null;
  const p95ms = p95Raw ? Number(p95Raw.replace(/_/g, '')) : null;
  const unwired = /@unwired\b/.test(src);
  return { lifecycle, matcher, p95ms, unwired };
}

function buildPayload(lifecycle, matcher) {
  const base = {
    session_id: 'bench-session',
    cwd: ROOT,
    transcript_path: '/tmp/bench-transcript.jsonl',
    hook_event_name: lifecycle,
  };

  switch (lifecycle) {
    case 'UserPromptSubmit':
      return { ...base, prompt: 'bench probe', user_message: 'bench probe' };
    case 'PreToolUse':
      return {
        ...base,
        tool_name: matcher?.split('|')[0] || 'Bash',
        tool_input: { command: 'true', file_path: '/tmp/none', content: '' },
      };
    case 'PostToolUse':
      return {
        ...base,
        tool_name: matcher?.split('|')[0] || 'Read',
        tool_input: { command: 'true', file_path: '/tmp/none' },
        tool_response: { success: true, output: '' },
      };
    case 'PostToolUseFailure':
      return {
        ...base,
        tool_name: matcher?.split('|')[0] || 'Read',
        tool_input: { file_path: '/tmp/none' },
        error: 'bench error',
      };
    case 'Stop':
      return { ...base, stop_hook_active: true };
    case 'SessionStart':
      return { ...base, source: 'startup' };
    case 'PreCompact':
      return { ...base, trigger: 'auto', custom_instructions: '' };
    default:
      return base;
  }
}

function runOnce(hookPath, payload) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(process.execPath, [hookPath], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CONSTRUCT_BENCH: '1' },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const elapsed = performance.now() - start;
      resolve({ elapsed, code: code ?? -1, timedOut });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ elapsed: performance.now() - start, code: -1, timedOut: false });
    });
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {}
  });
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// The unavoidable floor every hook pays: spawn a `.mjs` that reads stdin and
// exits with zero hook logic, measured exactly like a hook. Its p95 is the Node
// interpreter + stdin cost to subtract so a budget reflects the hook's own work.

async function measureBaseline() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cx-bench-baseline-'));
  const noop = path.join(dir, 'noop.mjs');
  writeFileSync(noop, 'let d="";process.stdin.on("data",(c)=>{d+=c});process.stdin.on("end",()=>process.exit(0));process.stdin.resume();\n');
  try {
    const times = [];
    for (let i = 0; i < RUNS; i++) times.push((await runOnce(noop, {})).elapsed);
    return percentile([...times].sort((a, b) => a - b), 95);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function benchOne(file, baselineMs = 0) {
  const name = path.basename(file, '.mjs');
  const header = parseHeader(file);
  if (header.unwired) return { name, lifecycle: header.lifecycle, skipped: 'unwired' };
  if (!header.lifecycle) return { name, skipped: 'no @lifecycle' };
  if (header.p95ms == null) return { name, lifecycle: header.lifecycle, skipped: 'no @p95ms' };

  const payload = buildPayload(header.lifecycle, header.matcher);
  const times = [];
  const exits = [];
  for (let i = 0; i < RUNS; i++) {
    const { elapsed, code, timedOut } = await runOnce(file, payload);
    times.push(elapsed);
    exits.push(timedOut ? 'timeout' : code);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1];
  const budget = header.p95ms;

  // Judge the hook's marginal cost over the shared Node floor, not absolute wall
  // time — the floor is interpreter overhead the budget was never meant to cover.
  const marginalP95 = Math.max(0, p95 - baselineMs);
  const status = marginalP95 <= budget * TOLERANCE ? 'pass' : 'fail';
  return {
    name,
    lifecycle: header.lifecycle,
    budgetMs: budget,
    medianMs: Math.round(median),
    p95Ms: Math.round(p95),
    baselineMs: Math.round(baselineMs),
    marginalP95Ms: Math.round(marginalP95),
    maxMs: Math.round(max),
    runs: times.length,
    exits: exits.reduce((a, e) => ((a[e] = (a[e] ?? 0) + 1), a), {}),
    status,
  };
}

async function main() {
  const files = readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join(HOOKS_DIR, f))
    .filter((f) => !ONLY_HOOK || path.basename(f, '.mjs') === ONLY_HOOK);

  const baselineMs = await measureBaseline();
  if (!JSON_ONLY) process.stderr.write(`baseline (Node+stdin floor) p95=${Math.round(baselineMs)}ms — subtracted from every hook\n`);

  const results = [];
  for (const file of files) {
    if (!JSON_ONLY) process.stderr.write(`bench ${path.basename(file)} ...`);
    const r = await benchOne(file, baselineMs);
    results.push(r);
    if (!JSON_ONLY) {
      if (r.skipped) process.stderr.write(` skipped (${r.skipped})\n`);
      else process.stderr.write(` p95=${r.p95Ms}ms marginal=${r.marginalP95Ms}ms budget=${r.budgetMs}ms ${r.status}\n`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runs: RUNS,
    tolerance: TOLERANCE,
    nodeVersion: process.version,
    baselineMs: Math.round(baselineMs),
    results,
  };

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report;
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(
    REPORT_DIR,
    `hooks-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stderr.write(`\nReport: ${reportPath}\n`);

  const failed = results.filter((r) => r.status === 'fail');
  if (failed.length) {
    process.stderr.write(`\n${failed.length} hook(s) over budget × ${TOLERANCE} (marginal over the ${Math.round(baselineMs)}ms Node floor):\n`);
    for (const r of failed) process.stderr.write(`  ${r.name}: marginal=${r.marginalP95Ms}ms > ${r.budgetMs * TOLERANCE}ms\n`);
    process.exitCode = 1;
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bench-hooks.mjs')) {
  main().catch((e) => {
    process.stderr.write(`bench-hooks failed: ${e?.stack || e}\n`);
    process.exit(2);
  });
}

export { main, benchOne, parseHeader, buildPayload };
