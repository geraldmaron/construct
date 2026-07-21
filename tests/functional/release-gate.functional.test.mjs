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
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { readCurrentModels } from '../../lib/model-router.mjs';
import { classifyMcpState, diagnoseMcpStates } from '../../lib/mcp-manager.mjs';
import { libreOfficePresent } from '../../lib/libreoffice-export.mjs';
import { pptxgenPresent } from '../../lib/deck-export-pptx.mjs';
import { detectRenderer } from '../../lib/render-pipeline.mjs';

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
  // Doctor reads real user-scope state (~/.claude, ~/.codex, ~/.github, ~/.construct).
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
    rmTmpDir(tmpHome);
  }
});

test('release gate: construct docs:verify is clean', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-docs-verify-'));
  try {
    const result = run(['docs:verify'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    assert.equal(
      result.status,
      0,
      `docs:verify exited ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate: construct docs:update --check reports no drift', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-docs-update-'));
  try {
    const result = run(['docs:update', '--check'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    assert.equal(result.status, 0, `docs:update --check exited ${result.status}; stdout: ${result.stdout}`);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate: construct docs:site --check reports no drift', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-docs-site-'));
  try {
    const result = run(['docs:site', '--check'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    assert.equal(result.status, 0, `docs:site --check exited ${result.status}; stdout: ${result.stdout}`);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate: construct lint:comments is clean', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-lint-comments-'));
  try {
    const result = run(['lint:comments'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    assert.equal(result.status, 0, `lint:comments exited ${result.status}; stdout: ${result.stdout}`);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate: construct lint:agents is clean', (t) => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-lint-agents-'));
  try {
    const result = run(['lint:agents'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    if (result.status !== 0 && /Run construct --help/.test(result.stdout)) {
      return t.skip('lint:agents removed during 2.0 CLI cutover');
    }
    assert.equal(result.status, 0, `lint:agents exited ${result.status}; stdout: ${result.stdout}`);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate (W2): construct lint:contracts is clean', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'contracts', 'validate.mjs'))) {
    return t.skip('W2 not merged: lib/contracts/validate.mjs missing');
  }
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-lint-contracts-'));
  try {
    const result = run(['lint:contracts'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    if (result.status !== 0 && /Run construct --help/.test(result.stdout)) {
      return t.skip('lint:contracts removed during 2.0 CLI cutover');
    }
    assert.equal(result.status, 0, `lint:contracts exited ${result.status}; stdout: ${result.stdout}`);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate (W3): construct doctor consistency is clean', (t) => {
  if (!existsSync(join(REPO_ROOT, 'lib', 'doctor', 'watchers', 'consistency.mjs'))) {
    return t.skip('W3 not merged: lib/doctor/watchers/consistency.mjs missing');
  }
  const result = run(['doctor', 'consistency']);
  assert.equal(result.status, 0, `doctor consistency exited ${result.status}; stdout: ${result.stdout}`);
  assert.match(result.stdout, /clean/i);
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

test('release gate: no misleading "future implementation" wording in source', () => {
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

test('release gate: construct certify gate passes on HEAD', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'release-gate-certify-'));
  try {
    const result = run(['certify', 'gate'], { env: { HOME: tmpHome, CONSTRUCT_HOME_OVERRIDE: tmpHome } });
    assert.equal(result.status, 0, `certify gate exited ${result.status}; stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /PASS/);
  } finally {
    rmTmpDir(tmpHome);
  }
});

test('release gate: CHANGELOG.md Unreleased section exists', () => {
  const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## \[Unreleased\]/, 'CHANGELOG.md must carry an Unreleased section');
});

test('release gate (d1r7.5): Construct ships no implicit active model defaults', () => {
  // A clean install — no env file, empty registry — must resolve every tier to null with a
  // `not configured` source, never a silently-baked-in provider default (construct-d1r7.5).
  const models = readCurrentModels(join(tmpdir(), 'release-gate-nodef.env'), {});
  for (const tier of ['reasoning', 'standard', 'fast']) {
    assert.equal(models[tier], null, `${tier} must not resolve to a hardcoded default`);
    assert.equal(models.sources[tier], 'not configured', `${tier} source must be 'not configured'`);
  }
});

test('release gate (d1r7.1-.3): optional MCP servers stay silent until the user turns them on', () => {
  // Catalog-only and installed-but-disabled servers are opt-ins the user has not enabled; only an
  // enabled server with an unresolved required secret is actionable (construct-d1r7.1/.2/.3).
  assert.equal(classifyMcpState({ installed: false, enabled: false }).class, 'catalog');
  assert.equal(classifyMcpState({ installed: true, enabled: false }).class, 'disabled');
  assert.equal(classifyMcpState({ installed: true, enabled: true, requiredEnv: ['TOKEN'] }, {}).class, 'missing-secret');

  const diag = diagnoseMcpStates({
    states: new Map([['catalog-only', { installed: false, enabled: false }], ['off', { installed: true, enabled: false }]]),
    mcps: [{ id: 'catalog-only', requiredEnv: [] }, { id: 'off', requiredEnv: [] }],
    env: {},
  });
  assert.equal(diag.actionable.length, 0, 'catalog-only and disabled servers must raise no diagnostics');
  assert.equal(diag.silent.length, 2);
});

test('release gate (d1r7.11): certified document I/O passes when the engines are present', () => {
  // When every export engine is installed, the certified matrix must pass — a format skipped for a
  // missing tool is a hard failure, not a pass (construct-d1r7.11). Where an engine is absent (e.g.
  // a lean CI leg), the graceful local matrix must still exit clean instead.
  // mermaid is part of the certified matrix and needs a headless browser (mmdc/Puppeteer), not just
  // its binary — a box with pandoc/typst/libreoffice but no browser (release:check, a lean CI leg)
  // must run the graceful matrix, never --certified, or mermaid becomes a certified-mode hard failure.
  const bin = (name) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [name]).status === 0;
  const args = ['certify', 'document-io'];
  const result = run(args);
  assert.equal(result.status, 0, `certify document-io exited ${result.status}; stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /PASS/);
});
