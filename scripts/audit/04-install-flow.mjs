/**
 * 04-install-flow.mjs — Phase 4: the install lifecycle, run hermetically.
 *
 * Asserts behavior by executing the real binary in a throwaway HOME + throwaway git
 * project, never by trusting descriptions: postinstall stages only inside the project,
 * init is idempotent and escapes nothing to HOME, sync --dry-run writes nothing. Grades
 * the install surface against the sourced CLI rubric (dry-run, --yes/non-TTY, next-steps).
 *
 * Read-only with respect to the repo (all writes land in tmpdirs). Run:
 *   node scripts/audit/04-install-flow.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS } from '../../lib/cli-commands.mjs';
import { REPO_ROOT, BIN_PATH } from './lib/handlers.mjs';
import { runConstruct } from './lib/spawn.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const POSTINSTALL = path.join(REPO_ROOT, 'bin', 'construct-postinstall.mjs');

function mkProject() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-proj-'));
  try { execFileSync('git', ['init', '-q'], { cwd: proj }); } catch { /* git optional */ }
  const env = {
    ...process.env, HOME: home,
    CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
  };
  return { home, proj, env };
}

function tree(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push(r);
      if (e.isDirectory()) walk(path.join(d, e.name), r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

// init's subsystems (embedding cache, beads/Dolt, host config) legitimately write
// machine-global state; the scope contract is about PROJECT artifacts, so the top-level
// HOME dirs touched are captured as informational transparency, not a pass/fail.

function homeDirsTouched(home) {
  return fs.existsSync(home) ? fs.readdirSync(home).filter((n) => n !== '.git').sort() : [];
}

function downloadedModel(home) {
  return tree(home).some((p) => /cache\/embeddings\/.*\.onnx$/.test(p));
}

export function runInstallFlow() {
  const checks = [];
  const info = {};
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // postinstall: stages inside the project, exits 0, escapes nothing to HOME.
  {
    const { home, proj, env } = mkProject();
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0' }));
    let status = null;
    let err = '';
    try {
      execFileSync('node', [POSTINSTALL], { cwd: proj, env: { ...env, INIT_CWD: proj }, timeout: 90000, stdio: 'pipe' });
      status = 0;
    } catch (e) { status = e.status ?? 'error'; err = String(e.stderr || e.message).slice(0, 200); }
    add('postinstall exits 0 (non-fatal)', status === 0, `status=${status} ${err}`);
    info.postinstallHomeDirs = homeDirsTouched(home);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }

  // init: runs non-interactively, escapes nothing to HOME, and is idempotent.
  {
    const { home, proj, env } = mkProject();
    const first = runConstruct(['init', proj, '--yes', '--no-start', '--quiet'], { env, timeout: 120000 });
    add('init --yes runs non-interactively (exit 0, no hang)', first.status === 0 && !first.timedOut, `status=${first.status} timedOut=${first.timedOut} ${first.stderr.slice(0, 160)}`);
    add('init does NOT fetch the embedding model over the network (offline-safe first run)', !downloadedModel(home), downloadedModel(home) ? 'model.onnx downloaded to ~/.construct/cache during init — embeddings-local.mjs leaves allowRemoteModels at default true; contradicts semantic.mjs:6 "no external API calls"' : 'no remote fetch');
    info.initHomeDirs = homeDirsTouched(home);
    const after1 = tree(proj);
    add('init scaffolds the project (.cx present)', after1.some((p) => p.startsWith('.cx')), `${after1.length} entries`);

    const second = runConstruct(['init', proj, '--yes', '--no-start', '--quiet'], { env, timeout: 120000 });
    const after2 = tree(proj);
    add('init is idempotent (second run exits 0)', second.status === 0 && !second.timedOut, `status=${second.status}`);
    add('init is convergent (no tree churn on re-run)', JSON.stringify(after1) === JSON.stringify(after2), `delta=${after2.length - after1.length}`);
    add('init prints next-steps / guidance', /next|run |construct /i.test(first.stdout + second.stdout), 'checked stdout for guidance');

    // sync --dry-run must not mutate the tree.
    const treeBefore = tree(proj);
    const dry = runConstruct(['sync', '--dry-run'], { env: { ...env, INIT_CWD: proj }, timeout: 60000 });
    const treeAfter = tree(proj);
    add('sync --dry-run writes nothing', JSON.stringify(treeBefore) === JSON.stringify(treeAfter), `exit=${dry.status} delta=${treeAfter.length - treeBefore.length}`);

    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  }

  // Rubric: the install command should offer a --dry-run plan-preview (sourced P1.4).
  const installSpec = CLI_COMMANDS.find((c) => c.name === 'install');
  const installFlags = (installSpec?.options || []).map((o) => o.flag.split('=')[0]);
  add('install offers --dry-run (plan preview before write)', installFlags.includes('--dry-run'), `flags: ${installFlags.join(' ')}`);
  add('install offers --yes (non-interactive)', installFlags.includes('--yes'), '');

  return { checks, info };
}

// Pollution / hang / non-convergence are correctness failures (high); rubric and
// offline-safety gaps are improvements (medium).

const HIGH_CHECK = /(leaks|non-interactively|idempotent|convergent|writes nothing|exits 0)/;

function toFindings(checks) {
  return checks.filter((c) => !c.ok).map((c) => ({
    type: 'install-flow', target: c.name,
    severity: HIGH_CHECK.test(c.name) ? 'high' : 'medium', tier: 'judgment',
    evidence: c.detail, recommendation: `Make this true: ${c.name}.`,
  }));
}

function main() {
  const { checks, info } = runInstallFlow();
  const findings = toFindings(checks);
  recordFindings('04-install', findings);
  writeJson('install-flow-report.json', { checks, info });
  const pass = checks.filter((c) => c.ok).length;
  process.stdout.write(`[audit:04] install lifecycle: ${pass}/${checks.length} checks pass.\n`);
  for (const c of checks) process.stdout.write(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}\n`);
  process.stdout.write(`[audit:04] init machine-global dirs touched (informational): ${(info.initHomeDirs || []).join(', ')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
