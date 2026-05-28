/**
 * lib/gates-audit.mjs — Cross-surface enforcement audit.
 *
 * Verifies that every policy gate is consistently expressed across the four
 * places enforcement can live: CI workflow jobs, the local pre-push hook,
 * the local pre-commit hook (when `core.hooksPath` is wired), and GitHub
 * branch protection (required status checks). Identifies gaps — checks that
 * exist in one place but not another, or that are required-to-merge but
 * absent from CI, or that are CI-only with no local mirror.
 *
 * The mapping between CI job names and local commands lives in the
 * GATE_DEFINITIONS table below. When a new CI job is added, the mapping
 * must be updated to declare what its local equivalent should be (or that
 * none is expected). This is the same single-source-of-truth pattern the
 * project already uses for CLI commands in lib/cli-commands.mjs.
 *
 * Exit code (in `construct gates:audit`): 0 if no critical gaps; 1 if any
 * critical gap is found. Non-critical advisories never fail the command.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = join(MODULE_DIR, '..');

// Authoritative gate mapping. Each entry declares a CI job name and its
// expected local mirror. `critical: true` means this gate MUST be in CI and
// SHOULD be in branch-protection required checks; absence is a hard gap.
// `localMirror: 'ci-only'` flags gates that legitimately have no local
// equivalent (e.g., dockerized integration tests).

const GATE_DEFINITIONS = [
  { ciJob: 'test (ubuntu-latest / node 22)', prePushLabel: 'tests', critical: true },
  { ciJob: 'test (macos-latest / node 22)',  prePushLabel: 'tests', critical: true },
  { ciJob: 'test (ubuntu-latest / node 20)', prePushLabel: 'tests', critical: true },
  { ciJob: 'test (macos-latest / node 20)',  prePushLabel: 'tests', critical: true },
  { ciJob: 'retrieval evals',                prePushLabel: 'evals', critical: true },
  { ciJob: 'dependency CVE audit',           prePushLabel: 'audit', critical: true },
  { ciJob: 'secret scanning',                prePushLabel: null,  preCommitCheck: 'ECC secret scan',               critical: true, note: 'pre-commit ECC scan covers a subset of gitleaks rules' },
  { ciJob: 'postgres + pgvector integration', prePushLabel: null, preCommitCheck: null,                            critical: false, note: 'CI-only: requires Docker Postgres + pgvector container; not practical locally', localMirror: 'ci-only' },
  { ciJob: 'docs drift check',               prePushLabel: 'docs', critical: true },
  { ciJob: 'comment policy',                 prePushLabel: null,  preCommitCheck: 'Construct comment-lint', critical: true, note: 'pre-commit Construct policy section calls `lint:comments` across the full worktree' },
  { ciJob: 'template policy',                prePushLabel: null,  preCommitGhPrIntercept: true,                    critical: true, note: 'pre-push-gate intercepts `gh pr create` / `gh pr edit` and lints the body' },
];

function parseCIJobs(rootDir) {
  const path = join(rootDir, '.github', 'workflows', 'ci.yml');
  if (!existsSync(path)) return [];
  const yml = readFileSync(path, 'utf8');
  return [...yml.matchAll(/^    name:\s*(.+?)\s*$/gm)]
    .map((m) => m[1].trim())
    .map((n) => n.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, k) => `<${k}>`));
}

function parsePrePushJobs(rootDir) {
  const path = join(rootDir, 'lib', 'hooks', 'pre-push-gate.mjs');
  if (!existsSync(path)) return [];
  const src = readFileSync(path, 'utf8');
  return [...src.matchAll(/label:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

function parsePreCommitChecks(rootDir) {
  const path = join(rootDir, '.beads', 'hooks', 'pre-commit');
  if (!existsSync(path)) return [];
  const src = readFileSync(path, 'utf8');
  const checks = [];
  if (src.includes('scan_added_lines')) checks.push('ECC secret scan');
  if (src.includes('construct lint:comments')) checks.push('Construct comment-lint');
  if (src.includes('construct docs:verify')) checks.push('Construct docs:verify');
  if (src.includes('BEADS INTEGRATION')) checks.push('BEADS dispatcher');
  return checks;
}

function getCoreHooksPath(rootDir) {
  try {
    return execSync('git config --get core.hooksPath', {
      cwd: rootDir, stdio: 'pipe', encoding: 'utf8', timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

function fetchBranchProtection(branch, { repo = 'geraldmaron/construct' } = {}) {
  try {
    const out = execSync(
      `gh api repos/${repo}/branches/${branch}/protection/required_status_checks`,
      { stdio: 'pipe', encoding: 'utf8', timeout: 5000 },
    );
    const data = JSON.parse(out);
    return { protected: true, requiredContexts: data.contexts || [], status: 'fetched' };
  } catch (err) {
    const msg = err?.stderr?.toString() || err?.message || '';
    if (/Branch not protected/i.test(msg)) {
      return { protected: false, requiredContexts: [], status: 'unprotected' };
    }
    return { protected: false, requiredContexts: [], status: 'unfetchable' };
  }
}

function ciHasJob(ciJobs, jobName) {
  if (ciJobs.includes(jobName)) return true;
  const stripped = jobName.replace(/\s*\([^)]*\)\s*/g, '').trim();
  return ciJobs.some((j) => j.replace(/\s*\(.*?\)\s*/g, '').trim() === stripped);
}

function identifyGaps(state) {
  const { ciJobs, prePushJobs, preCommitChecks, branchProtection, hooksPath, rootDir, inCI } = state;
  const gaps = [];
  const protectionVisible = branchProtection.status === 'fetched' || branchProtection.status === 'unprotected';

  for (const def of GATE_DEFINITIONS) {
    const inCi = ciHasJob(ciJobs, def.ciJob);
    if (!inCi) {
      gaps.push({ kind: 'missing-ci', gate: def.ciJob, critical: def.critical });
      continue;
    }

    if (def.critical && protectionVisible) {
      const required = branchProtection.requiredContexts.includes(def.ciJob);
      if (!required) {
        gaps.push({ kind: 'not-required-to-merge', gate: def.ciJob, critical: true });
      }
    }

    const hasPrePush = def.prePushLabel ? prePushJobs.includes(def.prePushLabel) : false;
    const hasPreCommit = def.preCommitCheck ? preCommitChecks.includes(def.preCommitCheck) : false;
    const hasIntercept = !!def.preCommitGhPrIntercept;
    const hasLocal = hasPrePush || hasPreCommit || hasIntercept || def.localMirror === 'ci-only';

    if (def.critical && !hasLocal) {
      gaps.push({ kind: 'no-local-mirror', gate: def.ciJob, note: def.note, critical: true });
    }
    if (!def.critical && !hasLocal && !def.note) {
      gaps.push({ kind: 'no-local-mirror-advisory', gate: def.ciJob, critical: false });
    }
  }

  if (protectionVisible) {
    for (const ctx of branchProtection.requiredContexts) {
      if (!ciHasJob(ciJobs, ctx)) {
        gaps.push({ kind: 'required-but-not-in-ci', gate: ctx, critical: true });
      }
    }
  }

  if (!inCI && existsSync(join(rootDir, '.beads', 'hooks', 'pre-commit')) && hooksPath !== '.beads/hooks') {
    gaps.push({
      kind: 'hooks-unwired',
      expected: '.beads/hooks',
      actual: hooksPath || '(unset)',
      critical: true,
      note: 'pre-commit policy gates are inactive locally; fix with: git config core.hooksPath .beads/hooks',
    });
  }

  return gaps;
}

export function auditGates({ rootDir = DEFAULT_ROOT_DIR, repo, branch = 'main' } = {}) {
  const inCI = process.env.CI === 'true' || process.env.CI === '1';
  const ciJobs = parseCIJobs(rootDir);
  const prePushJobs = parsePrePushJobs(rootDir);
  const preCommitChecks = parsePreCommitChecks(rootDir);
  const hooksPath = getCoreHooksPath(rootDir);
  const branchProtection = fetchBranchProtection(branch, repo ? { repo } : {});

  const state = { ciJobs, prePushJobs, preCommitChecks, branchProtection, hooksPath, rootDir, inCI };
  const gaps = identifyGaps(state);
  const criticalGaps = gaps.filter((g) => g.critical);

  return {
    rootDir,
    ciJobs,
    prePushJobs,
    preCommitChecks,
    hooksPath,
    branchProtection,
    gaps,
    criticalGaps,
    inCI,
    ok: criticalGaps.length === 0,
  };
}

export function formatReport(report) {
  const lines = [];
  lines.push('Construct Gates Audit');
  lines.push('═════════════════════');
  lines.push('');

  lines.push(`CI jobs (${report.ciJobs.length}):`);
  for (const j of report.ciJobs) lines.push(`  • ${j}`);
  lines.push('');

  lines.push(`Local pre-push gate jobs (${report.prePushJobs.length}):`);
  for (const j of report.prePushJobs) lines.push(`  • ${j}`);
  lines.push('');

  lines.push(`Local pre-commit checks (${report.preCommitChecks.length}):`);
  for (const j of report.preCommitChecks) lines.push(`  • ${j}`);
  lines.push('');

  lines.push(`core.hooksPath: ${report.hooksPath || '(unset)'}`);
  lines.push('');

  if (report.branchProtection.status === 'fetched') {
    lines.push(`Branch protection (main): ${report.branchProtection.requiredContexts.length} required contexts`);
    for (const c of report.branchProtection.requiredContexts) lines.push(`  • ${c}`);
  } else if (report.branchProtection.status === 'unprotected') {
    lines.push('Branch protection (main): NOT PROTECTED — no gate enforces CI before merge');
  } else {
    lines.push('Branch protection (main): unfetchable (insufficient gh permissions) — protection-dependent gaps skipped');
  }
  lines.push('');

  if (report.gaps.length === 0) {
    lines.push('Gaps: none');
  } else {
    lines.push(`Gaps (${report.gaps.length}; ${report.criticalGaps.length} critical):`);
    for (const g of report.gaps) {
      const marker = g.critical ? '✗' : '⚠';
      const detail = g.note ? ` — ${g.note}` : '';
      const extra = g.kind === 'hooks-unwired' ? ` (expected ${g.expected}, actual ${g.actual})` : '';
      lines.push(`  ${marker} ${g.kind}: ${g.gate || ''}${extra}${detail}`);
    }
  }
  lines.push('');

  lines.push(`Summary: ${report.ok ? 'OK ✓' : `${report.criticalGaps.length} critical gap(s) ✗`}`);

  return lines.join('\n') + '\n';
}
