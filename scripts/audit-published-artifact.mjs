#!/usr/bin/env node
/**
 * scripts/audit-published-artifact.mjs — audit the package as a consumer sees it.
 *
 * The repo-level `npm audit` runs inside this project, where this package.json's
 * `overrides` apply. npm `overrides` only take effect for the top-level project
 * doing an install — a published library's overrides are ignored by everyone who
 * depends on it. A repo audit can therefore pass while every downstream
 * `npm install @geraldmaron/construct` inherits a vulnerable transitive chain.
 *
 * The gate packs the real artifact, installs the tarball into a throwaway
 * project with no overrides in scope, and audits the dependency tree a consumer
 * actually gets. Production + optional deps are audited (consumers receive both);
 * dev deps are omitted (they never ship).
 *
 * Exit code 0 = clean at the configured level. Non-zero = consumer-visible
 * vulnerability, or a tooling failure that prevented the audit from running.
 *
 * Usage:
 *   node scripts/audit-published-artifact.mjs                  — default: --audit-level=high
 *   node scripts/audit-published-artifact.mjs --audit-level=moderate
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const auditLevel = args.find((a) => a.startsWith('--audit-level='))?.split('=')[1] || 'high';

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function die(label, detail) {
  console.error(`\n✗  ${label}`);
  if (detail) console.error(`   ${detail}`);
  process.exit(1);
}

console.log(`\nConsumer-perspective audit — packing @geraldmaron/construct and auditing as a downstream installer (level: ${auditLevel})\n`);

const packDir = mkdtempSync(join(tmpdir(), 'cx-pack-'));
const pack = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root });
if (!pack.ok) {
  rmSync(packDir, { recursive: true, force: true });
  die('npm pack failed', pack.stderr || pack.stdout);
}

let tarballName;
try {
  tarballName = JSON.parse(pack.stdout)[0].filename;
} catch (err) {
  rmSync(packDir, { recursive: true, force: true });
  die('could not parse npm pack output', err.message);
}
const tarballPath = join(packDir, tarballName);

const work = mkdtempSync(join(tmpdir(), 'cx-consumer-audit-'));
const localTarball = join(work, basename(tarballName));

try {
  copyFileSync(tarballPath, localTarball);

  const init = run('npm', ['init', '-y'], { cwd: work });
  if (!init.ok) die('npm init failed in temp project', init.stderr || init.stdout);

  // --ignore-scripts: the published package has a postinstall that bootstraps
  // Construct; the consumer dependency tree is identical with or without it,
  // and skipping keeps this gate fast and side-effect-free.

  const install = run('npm', ['install', localTarball, '--omit=dev', '--ignore-scripts'], { cwd: work });
  if (!install.ok) die('installing the packed tarball failed', install.stderr || install.stdout);

  const audit = run('npm', ['audit', '--omit=dev', `--audit-level=${auditLevel}`], { cwd: work });
  if (audit.ok) {
    console.log(`✓  Consumer install is clean at level "${auditLevel}" — no overrides relied upon.\n`);
    process.exit(0);
  }

  console.error(audit.stdout || audit.stderr);
  die(
    `Consumer-visible vulnerabilities at level "${auditLevel}".`,
    'A repo `overrides` pin will NOT fix this for consumers. Remediate the published tree: bump, replace, or drop the offending direct dependency. See docs/guides/reference/dependencies.md § Transitive vulnerability remediation.',
  );
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(packDir, { recursive: true, force: true });
}
