/**
 * tests/functional/published-package-smoke.functional.test.mjs — proves the
 * published npm package actually works, not just the dev-repo checkout.
 *
 * package.json's `files` whitelist and static imports of `tests/`/`.github/`
 * paths from shipped `lib/**` code are both easy to get wrong invisibly — the
 * dev repo has every file on disk regardless of the whitelist, so a missing
 * entry or a stray `tests/`-relative import only breaks for a real npm
 * consumer, never for a git clone. `npm pack`s the real artifact, installs
 * the tarball into a sterile tmpdir project (`--ignore-scripts`, no network
 * reliance beyond the local tarball), and drives the installed CLI exactly
 * as a consumer would.
 *
 * Slow (npm pack + install ~10-20s) — functional tier only, not the unit suite.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, ...opts });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    signal: result.signal,
  };
}

function packAndInstall(sandbox) {
  const packDir = join(sandbox, 'pack');
  mkdirSync(packDir, { recursive: true });
  const pack = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: REPO_ROOT });
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  const tarballName = JSON.parse(pack.stdout)[0].filename;
  const tarballPath = join(packDir, tarballName);

  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  const init = run('npm', ['init', '-y'], { cwd: project });
  assert.equal(init.status, 0, `npm init failed: ${init.stderr}`);

  // --ignore-scripts: the postinstall bootstraps host adapters, which is
  // orthogonal to what this gate proves (that the installed CLI runs at
  // all) and would make the gate slower and dependent on the sandbox HOME.
  const install = run('npm', ['install', tarballPath, '--omit=dev', '--ignore-scripts'], { cwd: project });
  assert.equal(install.status, 0, `installing the packed tarball failed: ${install.stderr}`);

  const cli = join(project, 'node_modules', '@geraldmaron', 'construct', 'bin', 'construct');
  assert.ok(existsSync(cli), `installed CLI entrypoint missing at ${cli}`);
  return { project, cli };
}

function runCli(cli, args, sandboxHome) {
  return run(process.execPath, [cli, ...args], {
    cwd: dirname(cli),
    env: {
      ...process.env,
      HOME: sandboxHome,
      CONSTRUCT_SKIP_POSTINSTALL: '1',
    },
  });
}

test('a real npm-packed install runs the core CLI surface without MODULE_NOT_FOUND or unshipped-path ENOENT', { timeout: 180_000 }, () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'published-package-smoke-'));
  try {
    const { cli, project } = packAndInstall(sandbox);
    const sandboxHome = join(sandbox, 'HOME');
    mkdirSync(sandboxHome, { recursive: true });

    // scripts/refresh-ci-status.mjs — dispatched from lib/hooks/ci-status-check.mjs,
    // must exist at the path the hook resolves relative to itself.
    const refresher = join(project, 'node_modules', '@geraldmaron', 'construct', 'scripts', 'refresh-ci-status.mjs');
    assert.ok(existsSync(refresher), 'scripts/refresh-ci-status.mjs must ship — lib/hooks/ci-status-check.mjs dispatches it on every consumer prompt');

    const doctor = runCli(cli, ['doctor'], sandboxHome);
    assert.doesNotMatch(doctor.stdout + doctor.stderr, /MODULE_NOT_FOUND|Cannot find module/, `doctor crashed on a missing module:\n${doctor.stderr}`);
    assert.doesNotMatch(doctor.stdout + doctor.stderr, /ENOENT.*tests[\\/]/, `doctor tried to read an unshipped tests/ path:\n${doctor.stderr}`);

    const syncDryRun = runCli(cli, ['sync', '--dry-run', '--global'], sandboxHome);
    assert.doesNotMatch(syncDryRun.stdout + syncDryRun.stderr, /MODULE_NOT_FOUND|Cannot find module/, `sync --dry-run crashed on a missing module:\n${syncDryRun.stderr}`);

    const evals = runCli(cli, ['evals', 'retrieval', '--json'], sandboxHome);
    assert.equal(evals.status, 0, `evals retrieval must succeed for a consumer:\n${evals.stderr}`);
    const evalsReport = JSON.parse(evals.stdout);
    assert.ok(evalsReport.queryCount > 0, 'evals retrieval must run real queries against the shipped fixture');

    const certifyStatus = runCli(cli, ['certify', 'status'], sandboxHome);
    assert.doesNotMatch(certifyStatus.stdout + certifyStatus.stderr, /MODULE_NOT_FOUND|Cannot find module/, `certify status crashed on a missing module rather than degrading:\n${certifyStatus.stderr}`);
  } finally {
    rmTmpDir(sandbox);
  }
});
