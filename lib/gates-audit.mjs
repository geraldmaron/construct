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
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadArtifactManifest, validateArtifactManifest } from './artifact-manifest.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = join(MODULE_DIR, '..');

// Authoritative gate mapping. Each entry declares a CI job name and its
// expected local mirror. `critical: true` means this gate MUST be in CI and
// SHOULD have a local mirror; absence is a hard gap. Branch-protection
// enforcement is checked via `requireMergeVia`: if set, the audit looks for
// that aggregator context in required checks instead of the gate's own job
// name. The `ci-required` aggregator job (ci.yml) wraps every conditional
// job and reports the combined success/skipped/failure status, which lets
// path-skipped jobs satisfy branch protection on doc-only PRs.
//
// `localMirror: 'ci-only'` flags gates that legitimately have no local
// equivalent (e.g., dockerized integration tests).

const MERGE_AGGREGATOR = 'ci-required';

const GATE_DEFINITIONS = [
  // Test, build, audit, evals, docs-drift, comment-policy, prose, profiles —
  // all CI-only. The local pre-push gate was shrunk to claude/* refusal +
  // SHA-aware red-CI re-push check + PR body lint; CI is the source of
  // truth for everything else (see CHANGELOG entry "Pre-push hooks shrunk
  // to local-only signals; CI is the source of truth" and the inverted
  // contract enforced by tests/ci-parity.test.mjs).
  { ciJob: 'test (ubuntu-latest / node 22)', prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'test (macos-latest / node 22)',  prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'test (ubuntu-latest / node 20)', prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'test (macos-latest / node 20)',  prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'retrieval evals',                prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'dependency CVE audit',           prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'secret scanning',                prePushLabel: null, preCommitCheck: 'ECC secret scan', critical: true, note: 'pre-commit ECC scan covers a subset of gitleaks rules' },
  { ciJob: 'postgres + pgvector integration', prePushLabel: null, preCommitCheck: null, critical: false, note: 'CI-only: requires Docker Postgres + pgvector container; not practical locally', localMirror: 'ci-only', requireMergeVia: MERGE_AGGREGATOR },
  { ciJob: 'docs drift check',               prePushLabel: null, critical: true, requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'comment policy',                 prePushLabel: null, preCommitCheck: 'Construct comment-lint', critical: true, note: 'pre-commit Construct policy section calls `lint:comments` across the full worktree', requireMergeVia: MERGE_AGGREGATOR },
  { ciJob: 'template policy',                prePushLabel: null, preCommitGhPrIntercept: true, critical: true, note: 'pre-push-gate intercepts `gh pr create` / `gh pr edit` and lints the body', requireMergeVia: MERGE_AGGREGATOR },
  { ciJob: 'certification gate',             prePushLabel: null, preCommitCheck: null, critical: true, note: 'artifact release-gate certification: `construct certify gate`; mirrored locally by release:check', requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: 'graph verify',                     prePushLabel: null, preCommitCheck: 'Construct graph verify', critical: true, note: 'pre-commit Construct policy section calls `construct graph verify`; required CI job in ci-required', requireMergeVia: MERGE_AGGREGATOR },
  { ciJob: 'graph impact gate',                prePushLabel: null, preCommitCheck: null, critical: true, note: 'PR-only impacted-test gate; inactive until shadow promotion criteria met', requireMergeVia: MERGE_AGGREGATOR, localMirror: 'ci-only' },
  { ciJob: MERGE_AGGREGATOR,                 prePushLabel: null, preCommitCheck: null, critical: true, note: 'aggregator: succeeds iff every wrapped conditional job in ci.yml ended in success or skipped', localMirror: 'ci-only' },
];

function parseCIJobs(rootDir) {
  // Extracts both job-level names and step-level names. Consolidated jobs
  // (e.g. the `lint suite` job carrying comment policy + docs drift + gates
  // audit as steps) surface each step name as a gate signal. The audit's
  // job-name comparison treats jobs and steps as a flat union so gate
  // definitions stay decoupled from CI structure. Reads ci.yml plus any
  // sibling workflow files that emit required-to-merge contexts (currently
  // pr-review.yml for the `review` job).
  const dir = join(rootDir, '.github', 'workflows');
  const files = ['ci.yml', 'pr-review.yml'];
  const names = [];
  for (const file of files) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const yml = readFileSync(path, 'utf8');
    const jobNames = [...yml.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((m) => m[1].trim());
    const stepNames = [...yml.matchAll(/^ {6}- name:\s*(.+?)\s*$/gm)].map((m) => m[1].trim());
    names.push(...jobNames, ...stepNames);
  }
  return names.map((n) => n.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, k) => `<${k}>`));
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
  if (src.includes('construct graph verify')) checks.push('Construct graph verify');
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

// git honours an absolute core.hooksPath, and a shared checkout with worktrees
// needs one so the hooks resolve from every worktree. A literal string compare
// against '.beads/hooks' therefore reported active gates as inactive. What the
// gate actually depends on is whether the configured directory holds the
// pre-commit hook, so resolve the path and look.

function hooksPathIsWired(hooksPath, rootDir) {
  if (!hooksPath) return false;
  const resolved = isAbsolute(hooksPath) ? hooksPath : join(rootDir, hooksPath);
  return existsSync(join(resolved, 'pre-commit'));
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
      const mergeContext = def.requireMergeVia || def.ciJob;
      const required = branchProtection.requiredContexts.includes(mergeContext);
      if (!required) {
        gaps.push({
          kind: 'not-required-to-merge',
          gate: def.ciJob,
          via: mergeContext === def.ciJob ? undefined : mergeContext,
          critical: true,
        });
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

  if (!inCI && existsSync(join(rootDir, '.beads', 'hooks', 'pre-commit')) && !hooksPathIsWired(hooksPath, rootDir)) {
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

// Artifact-gate config drift: the manifest's qualityContract gate levels and required completion
// states are the source of truth for what each artifact's release gate enforces. A typo or an
// out-of-enum level silently weakens the gate, so the audit validates the manifest and reports any
// drift. A repo with no manifest (the gates-audit fixture) is skipped, not failed.

export function auditArtifactGateConfig(rootDir = DEFAULT_ROOT_DIR) {
  const manifestPath = join(rootDir, 'registry', 'artifact-manifest.json');
  if (!existsSync(manifestPath)) return { ok: true, errors: [], skipped: 'no manifest' };
  try {
    const manifest = loadArtifactManifest({ rootDir, force: true });
    const result = validateArtifactManifest(manifest);
    return { ok: result.valid, errors: result.errors || [] };
  } catch (err) {
    return { ok: false, errors: [`artifact-manifest unreadable: ${err.message}`] };
  }
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

  const artifactGateConfig = auditArtifactGateConfig(rootDir);
  for (const error of artifactGateConfig.errors) {
    gaps.push({ kind: 'artifact-gate-config-drift', gate: error, critical: true });
  }

  const criticalGaps = gaps.filter((g) => g.critical);

  return {
    rootDir,
    ciJobs,
    prePushJobs,
    preCommitChecks,
    hooksPath,
    branchProtection,
    artifactGateConfig,
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

  if (report.artifactGateConfig) {
    const cfg = report.artifactGateConfig;
    const state = cfg.skipped ? `skipped (${cfg.skipped})` : (cfg.ok ? 'OK ✓' : `${cfg.errors.length} drift issue(s) ✗`);
    lines.push(`Artifact gate config: ${state}`);
    for (const e of cfg.errors || []) lines.push(`  • ${e}`);
    lines.push('');
  }

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
      const via = g.via ? ` (via ${g.via})` : '';
      lines.push(`  ${marker} ${g.kind}: ${g.gate || ''}${via}${extra}${detail}`);
    }
  }
  lines.push('');

  lines.push(`Summary: ${report.ok ? 'OK ✓' : `${report.criticalGaps.length} critical gap(s) ✗`}`);

  return lines.join('\n') + '\n';
}
