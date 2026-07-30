#!/usr/bin/env node
/**
 * scripts/release-evidence-gate.mjs — release packaging evidence gate.
 *
 * A release can claim a capability in docs, `construct status`, and
 * `construct doctor` while the packed artifact a consumer actually installs
 * silently lacks the file that implements it (a `package.json` "files"
 * omission) or the acceptance test that once proved it regresses unnoticed.
 * For every capability lib/mode-capabilities.mjs's CAPABILITY_REGISTRY marks
 * 'implemented', the gate reads the packed file list via `npm pack --json
 * --dry-run` (no tarball written, no install — the same "what would actually
 * ship" signal tests/acceptance/packed-install.test.mjs's L2 harness proves
 * end-to-end with a real install), requires every capability's registered
 * backing file(s) to be present in it, then runs the capability's registered
 * acceptance test file and requires it not to fail (a self-skip — e.g.
 * team/enterprise legs with no reachable Postgres — is a warning, not a
 * failure, matching those tests' own self-skip contract).
 *
 * A capability with no CAPABILITY_BACKING_FILES / CAPABILITY_ACCEPTANCE_TESTS
 * entry is itself a gate failure — the map must be extended in the same PR
 * that flips a capability's status to 'implemented', or the gate cannot see it.
 *
 * Importable (`runReleaseEvidenceGate`) so the self-test drives it in-process
 * with injected overrides; runnable as:
 *   node scripts/release-evidence-gate.mjs [--json] [--skip-tests]
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { CAPABILITY_REGISTRY } from '../lib/mode-capabilities.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

/**
 * capability id -> repo-relative file(s) whose presence in the packed
 * artifact is necessary for the capability to function at runtime. Not an
 * exhaustive dependency closure — the module a missing-asset regression would
 * break first.
 */
export const CAPABILITY_BACKING_FILES = {
  'filesystem-queue': ['lib/intake/filesystem-queue.mjs'],
  'local-memory': ['lib/observation-store.mjs'],
  'embedded-lancedb': ['lib/storage/vector-client.mjs'],
  'direct-mcp': ['lib/mcp/server.mjs'],
  'postgres-queue': ['lib/queue/pg-queue.mjs'],
  'worker-heartbeat': ['lib/orchestration/worker-runtime.mjs'],
  'mandatory-audit': ['lib/audit-trail.mjs', 'lib/policy/audit-gate.mjs'],
};

/** capability id -> repo-relative acceptance test file that exercises it. */
export const CAPABILITY_ACCEPTANCE_TESTS = {
  'filesystem-queue': 'tests/acceptance/modes/solo.acceptance.test.mjs',
  'local-memory': 'tests/acceptance/modes/solo.acceptance.test.mjs',
  'embedded-lancedb': 'tests/acceptance/modes/solo.acceptance.test.mjs',
  'direct-mcp': 'tests/acceptance/modes/solo.acceptance.test.mjs',
  'postgres-queue': 'tests/acceptance/modes/team.acceptance.test.mjs',
  'worker-heartbeat': 'tests/acceptance/modes/team.acceptance.test.mjs',
  'mandatory-audit': 'tests/enterprise/audit-isolation.test.mjs',
};

/** Repo-relative packed file paths, via `npm pack --json --dry-run` (no tarball written). */
export function packedFileSet({ cwd = REPO_ROOT, execFile = execFileSync } = {}) {
  const out = execFile('npm', ['pack', '--json', '--dry-run'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out);
  const files = parsed[0]?.files ?? [];
  return new Set(files.map((f) => f.path));
}

function hasSkippedTests(output) {
  const match = output.match(/ℹ skipped (\d+)/);
  return Boolean(match && Number(match[1]) > 0);
}

function runTestFile(cwd, testFile, { execFile = execFileSync } = {}) {
  try {
    const output = execFile(process.execPath, ['--test', testFile], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, skipped: hasSkippedTests(output), output };
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`;
    return { ok: false, skipped: false, output };
  }
}

/**
 * runReleaseEvidenceGate(opts)
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {object} [opts.capabilityRegistry]     defaults to the real CAPABILITY_REGISTRY
 * @param {object} [opts.backingFiles]            defaults to CAPABILITY_BACKING_FILES
 * @param {object} [opts.acceptanceTests]          defaults to CAPABILITY_ACCEPTANCE_TESTS
 * @param {boolean} [opts.runAcceptanceTests=true] set false (the CLI's --skip-tests) to check packaging only, faster
 * @param {Function} [opts.packedFiles]            override for packedFileSet (self-test injection)
 * @param {Function} [opts.execFile]               override for execFileSync (self-test injection)
 * @returns {{ ok: boolean, errors: string[], warnings: string[], capabilities: object[] }}
 */
export function runReleaseEvidenceGate({
  cwd = REPO_ROOT,
  capabilityRegistry = CAPABILITY_REGISTRY,
  backingFiles = CAPABILITY_BACKING_FILES,
  acceptanceTests = CAPABILITY_ACCEPTANCE_TESTS,
  runAcceptanceTests = true,
  packedFiles = null,
  execFile = execFileSync,
} = {}) {
  const errors = [];
  const warnings = [];
  const capabilities = [];

  const packed = packedFiles ?? packedFileSet({ cwd, execFile });

  for (const mode of Object.keys(capabilityRegistry)) {
    for (const cap of capabilityRegistry[mode]) {
      if (cap.status !== 'implemented') continue;
      const entry = { mode, id: cap.id, label: cap.label, packaged: false, tested: null, testSkipped: false };

      const required = backingFiles[cap.id];
      if (!required) {
        errors.push(`${mode}/${cap.id}: status 'implemented' but has no CAPABILITY_BACKING_FILES entry in the release gate`);
      } else {
        const missing = required.filter((f) => !packed.has(f));
        entry.packaged = missing.length === 0;
        if (missing.length) errors.push(`${mode}/${cap.id}: packed artifact is missing required file(s): ${missing.join(', ')}`);
      }

      const testFile = acceptanceTests[cap.id];
      if (!testFile) {
        errors.push(`${mode}/${cap.id}: status 'implemented' but has no CAPABILITY_ACCEPTANCE_TESTS entry in the release gate`);
      } else if (!existsSync(join(cwd, testFile))) {
        errors.push(`${mode}/${cap.id}: acceptance test file does not exist: ${testFile}`);
      } else if (runAcceptanceTests) {
        const result = runTestFile(cwd, testFile, { execFile });
        entry.tested = result.ok;
        entry.testSkipped = result.skipped;
        if (!result.ok) errors.push(`${mode}/${cap.id}: acceptance test failed: ${testFile}\n${result.output}`);
        else if (result.skipped) warnings.push(`${mode}/${cap.id}: acceptance test self-skipped (no reachable Postgres) — not independently verified this run: ${testFile}`);
      }

      capabilities.push(entry);
    }
  }

  return { ok: errors.length === 0, errors, warnings, capabilities };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const runAcceptanceTests = !args.includes('--skip-tests');

  const result = runReleaseEvidenceGate({ runAcceptanceTests });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Release evidence gate: ${result.capabilities.length} 'implemented' capabilities checked.`);
    for (const cap of result.capabilities) {
      const mark = cap.packaged && cap.tested !== false ? '✓' : '✗';
      console.log(`  ${mark} ${cap.mode}/${cap.id} — packaged:${cap.packaged} tested:${cap.tested}${cap.testSkipped ? ' (skipped)' : ''}`);
    }
    for (const w of result.warnings) console.log(`  warn: ${w}`);
    for (const e of result.errors) console.error(`  error: ${e}`);
    console.log(result.ok ? '\n✓ release evidence gate passed' : `\n✖ release evidence gate failed (${result.errors.length} error(s))`);
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
