/**
 * tests/functional/bun-compiled-binary.functional.test.mjs — construct-qvou regression.
 *
 * Compiles bin/construct with `bun build --compile` and asserts the resulting
 * binary prints real output for version/--help/doctor, exit 0 only on real
 * success. Guards against two failure modes that otherwise make the binary
 * exit 0 with zero output for every command: (1) Bun's --compile bundler
 * never traversing an extensionless entry's imports at all, and (2) every
 * bundled module's import.meta.url/process.argv[1] collapsing to the same
 * virtual /$bunfs/root path, which breaks install-root resolution and makes
 * every "was I run directly" script guard across lib/*.mjs fire at once.
 * Skips (does not fail) when Bun is not installed — CI's default test job
 * has no Bun; the dedicated .github/workflows/bun-binary-smoke.yml installs
 * Bun and runs this test alongside the rest of the suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = resolve(ROOT, 'bin', 'construct');
const BUILD_ENTRY = resolve(ROOT, 'bin', '.construct-build-entry.test.mjs');

// The compiled binary's install-root fallback (lib/roots.mjs's
// resolveInstallRoot) resolves one directory up from process.execPath — the
// same "bin/<entry> -> repo root" depth scripts/build-binary.mjs's dist/
// layout assumes. An output path outside the checkout (e.g. os.tmpdir())
// would not have a real registry/skills/templates tree one level up and
// would fail for a reason unrelated to the thing under test, so the compiled
// binary under test is placed in the real dist/ dir alongside the real build.

function bunAvailable() {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function hostTargetId() {
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  return plat && arch ? `bun-${plat}-${arch}` : null;
}

test('a Bun-compiled binary of bin/construct runs real commands instead of silently no-op-ing', (t) => {
  if (!bunAvailable()) {
    t.skip('bun not installed on PATH — this is the Bun-binary track, gated separately from the default suite');
    return;
  }
  const target = hostTargetId();
  if (!target) {
    t.skip(`unsupported host platform/arch for a Bun-compiled binary smoke build (${process.platform}/${process.arch})`);
    return;
  }

  const distDir = resolve(ROOT, 'dist');
  mkdirSync(distDir, { recursive: true });
  const outfile = resolve(distDir, `construct-test-${randomUUID()}`);
  t.after(() => { try { rmSync(outfile, { force: true }); } catch {} });

  // Same extension trick scripts/build-binary.mjs uses: the entry must sit in
  // the real bin/ directory for its ../lib/... imports to resolve, but with a
  // recognized extension or Bun's --compile bundler will not traverse them.
  copyFileSync(ENTRY, BUILD_ENTRY);
  try {
    const build = spawnSync('bun', ['build', '--compile', `--target=${target}`, BUILD_ENTRY, '--outfile', outfile], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(build.status, 0, `bun build --compile failed:\n${build.stdout}\n${build.stderr}`);
    assert.ok(existsSync(outfile), 'compiled binary was not produced');

    // Timeouts carry headroom for a loaded machine: the full suite now runs to
    // completion (construct-ox25y), so this heavy build-and-run test can execute
    // while the box is still warm, where a tight bound flakes the correctness
    // assertion (a killed subprocess truncates stdout) rather than the behavior.
    const version = spawnSync(outfile, ['version'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(version.status, 0, `construct version failed: stdout=${version.stdout} stderr=${version.stderr}`);
    assert.match(version.stdout, /^construct v\d+\.\d+\.\d+/, 'version did not print a real version string');

    const help = spawnSync(outfile, ['--help'], { encoding: 'utf8', timeout: 30_000 });
    assert.match(help.stdout, /Usage: construct <command>/, '--help did not print real usage text');

    const doctor = spawnSync(outfile, ['doctor'], { encoding: 'utf8', timeout: 60_000 });
    assert.match(doctor.stdout, /^Results: \d+ passed, \d+ warnings?, \d+ failed/m, 'doctor did not print a real health report');
  } finally {
    rmSync(BUILD_ENTRY, { force: true });
  }
});
