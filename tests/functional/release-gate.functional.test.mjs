/**
 * tests/functional/release-gate.functional.test.mjs — Release-gate integration.
 *
 * Spawns the real `construct` binary against the live repo and asserts every
 * release-blocking gate exits cleanly. Each subtest depends on a specific
 * workstream landing; tests are conditionally skipped (with a clear reason)
 * when the subsystem isn't present, so this file can land before all the
 * workstream PRs merge and progressively activate as each lands.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function run(args, opts = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout ?? 120_000,
  });
}

test('release gate: construct --version exits 0 and reports the package version', () => {
  const result = run(['--version']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.match(result.stdout, new RegExp(pkg.version.replace(/\./g, '\\.')));
});

test('release gate: construct doctor exits 0 (warnings allowed, no failures)', () => {
  // Doctor reads real user-scope state (~/.claude, ~/.codex, ~/.github, ~/.cx).
  // Without HOME isolation the test inherits whatever the dev box happens to
  // have — including legacy v1.0.10 cx-* files left by an older installed
  // Construct that the test suite itself regenerates via mid-run sync. Same
  // isolation pattern as tests/sync-contract.test.mjs:43-78.
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-doctor-'));
  try {
    const result = run(['doctor'], { env: { HOME: tmpHome } });
    assert.equal(result.status, 0, `doctor exited ${result.status}; stderr: ${result.stderr}`);
    const failedMatch = result.stdout.match(/(\d+)\s+failed/);
    assert.ok(!failedMatch || failedMatch[1] === '0', `expected 0 failed checks, got: ${failedMatch?.[0]}`);
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('release gate: construct docs:verify is clean', () => {
  const result = run(['docs:verify']);
  assert.equal(
    result.status,
    0,
    `docs:verify exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('release gate: construct docs:update --check reports no drift', () => {
  const result = run(['docs:update', '--check']);
  assert.equal(result.status, 0, `docs:update --check exited ${result.status}; stdout: ${result.stdout}`);
});

test('release gate: construct lint:comments is clean', () => {
  const result = run(['lint:comments']);
  assert.equal(result.status, 0, `lint:comments exited ${result.status}; stdout: ${result.stdout}`);
});

test('release gate: construct lint:agents is clean', () => {
  const result = run(['lint:agents']);
  assert.equal(result.status, 0, `lint:agents exited ${result.status}; stdout: ${result.stdout}`);
});

test('release gate (W2): construct lint:contracts is clean', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs'))) {
    return t.skip('W2 not merged: lib/contracts/validate.mjs missing');
  }
  const result = run(['lint:contracts']);
  assert.equal(result.status, 0, `lint:contracts exited ${result.status}; stdout: ${result.stdout}`);
});

test('release gate (W3): construct doctor consistency is clean', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'doctor', 'watchers', 'consistency.mjs'))) {
    return t.skip('W3 not merged: lib/doctor/watchers/consistency.mjs missing');
  }
  const result = run(['doctor', 'consistency']);
  assert.equal(result.status, 0, `doctor consistency exited ${result.status}; stdout: ${result.stdout}`);
  assert.match(result.stdout, /clean/i);
});

test('release gate (W4): construct migrate --dry-run reports no migrations needed at HEAD', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'migrations', 'index.mjs'))) {
    return t.skip('W4 not merged: lib/migrations/index.mjs missing');
  }
  const result = run(['migrate', '--dry-run']);
  assert.equal(result.status, 0, `migrate --dry-run exited ${result.status}; stdout: ${result.stdout}`);
});

test('release gate (W1): boundary handshake module exposes the public contract', async (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'boundary.mjs'))) {
    return t.skip('W1 not merged: lib/boundary.mjs missing');
  }
  const mod = await import(`file://${join(REPO_ROOT, 'lib', 'boundary.mjs')}`);
  assert.equal(typeof mod.registerBoundary, 'function');
  assert.equal(typeof mod.boundaryConfigPath, 'function');
  assert.equal(typeof mod.signBoundaryRequest, 'function');
});

test('release gate (W5): daemon safeguard contract exposes createDaemon + classifyPacket', async (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'daemons', 'contract.mjs'))) {
    return t.skip('W5 not merged: lib/daemons/contract.mjs missing');
  }
  const mod = await import(`file://${join(REPO_ROOT, 'lib', 'daemons', 'contract.mjs')}`);
  assert.equal(typeof mod.createDaemon, 'function');
  assert.equal(typeof mod.classifyPacket, 'function');
  assert.equal(typeof mod.readHeartbeat, 'function');
});

test('release gate (W5): rule-verifier exports verifyTranscript with the documented surface', async (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'hooks', 'rule-verifier.mjs'))) {
    return t.skip('W5 not merged: lib/hooks/rule-verifier.mjs missing');
  }
  const mod = await import(`file://${join(REPO_ROOT, 'lib', 'hooks', 'rule-verifier.mjs')}`);
  assert.equal(typeof mod.verifyTranscript, 'function');
  assert.equal(typeof mod.classifyApproval, 'function');
  assert.equal(typeof mod.findConsequentialActions, 'function');
});

test('release gate (W1): no misleading "future implementation" wording in source', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'boundary.mjs'))) {
    return t.skip('W1 not merged: deferred-wording purge is part of that PR');
  }
  const result = spawnSync('rg', [
    '-i',
    'phase [abc] follow-up|in a real implementation|would go here|coming soon|not yet supported',
    'lib/', 'bin/', 'scripts/',
    '--type-add', 'src:*.{mjs,js}',
    '-t', 'src',
  ], { cwd: REPO_ROOT, encoding: 'utf8' });

  // rg exit 0 means it found matches; 1 means clean.
  if (result.status === 0) {
    const lines = result.stdout.split('\n').filter((line) => line
      && !line.includes('static/assets')
      && !line.includes('static/_next/')
      && !line.includes('lib/comment-lint.mjs')
    );
    assert.equal(lines.length, 0, `expected zero misleading-wording matches in source, got:\n${lines.join('\n')}`);
  }
});

test('release gate: CHANGELOG.md Unreleased section exists', () => {
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## \[Unreleased\]/, 'CHANGELOG.md must carry an Unreleased section');
});
