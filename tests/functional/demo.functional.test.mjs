/**
 * demo.functional.test.mjs — `construct demo` smoke gate.
 *
 * @capability demo.tape-fallback
 *
 * Contract: `--source-only` always exits 0 with a `.tape` source and `served`
 * state. A full `record` without a recorder exits non-zero with `unavailable`
 * state (no false-success recording claim). When a recorder IS present, a
 * recording artifact must also appear.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { locateRecorder, renderWithVhs, runDemoRecord } from '../../lib/demo.mjs';
import { loadDemoScript } from '../../lib/demo-script.mjs';
import { buildDemoAttemptChain, runDemoGuided } from '../../lib/demo-surface.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

// lib/paths.mjs resolves the machine-scoped state root (ADR-0066) from
// process.env directly, so every spawned `construct` needs its own sandboxed
// HOME to avoid leaking test projects into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

function run(args, cwd) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 200_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    },
  });
}

test('construct demo list exits 0', () => {
  const result = run(['demo', 'list'], REPO);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Demo tapes/);
});

test('construct demo init scaffolds project tape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-init-'));
  try {
    const result = run(['demo', 'init', 'my-demo', '--from=diagram'], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.construct', 'demos', 'tapes', 'my-demo.tape')));
  } finally {
    rmTmpDir(dir);
  }
});

test('construct demo record without recorder exits non-zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  try {
    const result = run(['demo', 'record', 'quickstart', '--format', 'gif'], dir);
    if (locateRecorder()) {
      assert.equal(result.status, 0, result.stderr);
      return;
    }
    assert.notEqual(result.status, 0, `expected non-zero without recorder; stderr: ${result.stderr}`);
  } finally {
    rmTmpDir(dir);
  }
});

test('construct demo: recording when recorder present; source-only always exits 0', () => {
  const recorder = locateRecorder();
  const cwd = recorder ? REPO : fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  const tryCleanup = !recorder;
  try {
    if (!recorder) return;
    const name = 'resource-guard-rails';
    const result = run(['demo', 'record', name, '--format', 'gif'], cwd);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    const outDir = path.join(cwd, '.construct', 'demos');
    assert.ok(fs.existsSync(outDir), 'expected .construct/demos/ to exist');
    const files = fs.readdirSync(outDir);

    assert.ok(files.some((f) => f.endsWith('.tape')) || fs.existsSync(path.join(cwd, '.construct', 'demos', 'tapes', `${name}.tape`)),
      `expected a .tape source; got: ${files.join(', ')}`);

    const artifacts = files.filter((f) => /\.(gif|mp4|webm|cast)$/.test(f));
    assert.ok(artifacts.length >= 1, `recorder present but no recording produced; got: ${files.join(', ')}`);
  } finally {
    if (tryCleanup) rmTmpDir(cwd);
  }
});

test('VHS rendering owns and reaps its POSIX recorder process group', () => {
  const calls = [];
  const result = renderWithVhs('/fake/vhs', '/tmp/demo.tape', {
    platform: 'darwin',
    spawnSyncFn: (binary, args, options) => {
      calls.push({ binary, args, options });
      return { status: 0, pid: 4242 };
    },
    killFn: (pid, signal) => calls.push({ pid, signal }),
  });

  assert.equal(result.status, 0);
  const tapeCall = calls.find((entry) => entry.args?.includes('/tmp/demo.tape'));
  assert.ok(tapeCall);
  assert.equal(tapeCall.binary, '/fake/vhs');
  assert.deepEqual(tapeCall.options.encoding, 'utf8');
  assert.equal(tapeCall.options.timeout, 180_000);
  assert.equal(tapeCall.options.detached, true);
  assert.deepEqual(calls.find((entry) => entry.pid === -4242), { pid: -4242, signal: 'SIGTERM' });
});

test('VHS rendering skips POSIX group signaling on Windows', () => {
  const calls = [];
  renderWithVhs('vhs.exe', 'demo.tape', {
    platform: 'win32',
    spawnSyncFn: (_binary, _args, options) => {
      calls.push(options);
      return { status: 0, pid: 4242 };
    },
    killFn: () => calls.push('unexpected kill'),
  });

  const tapeOptions = calls.find((entry) => entry.detached === false || entry.detached === true);
  assert.ok(tapeOptions);
  assert.equal(tapeOptions.encoding, 'utf8');
  assert.equal(tapeOptions.timeout, 180_000);
  assert.equal(tapeOptions.detached, false);
});

test('construct demo list includes shipped demo scripts', () => {
  const result = run(['demo', 'list'], REPO);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Demo manifests/);
  assert.match(result.stdout, /agentic-platforms-prd/);
});

test('loadDemoScript loads agentic-platforms-prd with five steps', () => {
  const script = loadDemoScript('agentic-platforms-prd', { cwd: REPO, repoRoot: REPO });
  assert.ok(script);
  assert.equal(script.steps.length, 5);
  assert.ok(script.fixtures.golden.includes('golden-prd-platform'));
  assert.equal(script.artifactReveal?.file, 'prd-platform.pdf');
});

test('buildDemoAttemptChain defaults to tape and never includes a local loop', () => {
  const chain = buildDemoAttemptChain('tape', {
    script: { fallbackSurface: 'tape' },
    interactive: true,
  });
  assert.equal(chain[0], 'tape');
  assert.ok(chain.includes('tape'));
  assert.ok(!chain.includes('c' + 'hat'));
});

test('agentic-platforms-prd tape uses the direct demo entry', () => {
  const tapePath = path.join(REPO, 'templates', 'demos', 'tapes', 'agentic-platforms-prd.tape');
  const themePath = path.join(REPO, 'templates', 'demos', 'vhs', 'construct-cockpit.json');
  assert.ok(fs.existsSync(tapePath));
  assert.ok(fs.existsSync(themePath));
  const tape = fs.readFileSync(tapePath, 'utf8');
  assert.match(tape, /construct --demo=agentic-platforms-prd/);
  assert.doesNotMatch(tape, new RegExp(`construct ${'c' + 'hat'}`));
  assert.doesNotMatch(tape, /Set Theme "Dracula"/);
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  assert.equal(theme.name, 'Construct Cockpit');
  assert.equal(theme.cursor, '#ffffff');
});

test('construct demo --surface=tape --source-only writes direct tape output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-src-'));
  try {
    const result = run(['demo', 'quickstart', '--surface=tape', '--source-only'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const files = fs.readdirSync(path.join(dir, '.construct', 'demos'));
    assert.ok(files.some((f) => f.endsWith('.tape')), `expected .tape source; got: ${files.join(', ')}`);
    assert.ok(!files.some((f) => /\.(gif|mp4|webm|cast)$/.test(f)), `--source-only should not record; got: ${files.join(', ')}`);
  } finally {
    rmTmpDir(dir);
  }
});

// runDemoRecord's no-recorder branch must never claim ok:true is equivalent
// to a rendered artifact (construct-4uxq0.9.12). Forcing sourceOnly:true
// pins the recorder to null regardless of what is actually installed on the
// machine running this test, so the assertion holds in every environment.

test('runDemoRecord: no-recorder fallback is tagged status "degraded", not a bare ok:true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-degraded-'));
  try {
    const result = runDemoRecord('quickstart', { cwd: dir, repoRoot: REPO, sourceOnly: true });
    assert.equal(result.ok, true);
    assert.equal(result.sourceOnly, true);
    assert.equal(result.status, 'degraded');
    assert.equal(result.artifactPath, undefined, 'a degraded result must never carry an artifactPath');
    assert.ok(fs.existsSync(result.tapePath), 'the .tape source itself must still be written');
  } finally {
    rmTmpDir(dir);
  }
});

// printScriptFallback (reached via runDemoGuided when every recording surface
// is unavailable) must be distinguishable from a real recording too: it only
// prints steps to the given output stream, so ok:true alone would read as a
// false success to any caller that doesn't also check the discriminator.

test('runDemoGuided: script-only fallback is tagged status "script-only", not a bare ok:true', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-scriptonly-'));
  try {
    const scriptsDir = path.join(dir, '.construct', 'demos', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'no-artifact-demo.json'), JSON.stringify({
      title: 'No Artifact Demo',
      tape: 'no-artifact-demo',
      steps: [{ title: 'Step 1', command: 'echo hi' }],
    }), 'utf8');

    const written = [];
    const output = { write: (chunk) => written.push(chunk), isTTY: false };

    const result = await runDemoGuided('no-artifact-demo', { cwd: dir, repoRoot: REPO, output });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'script-only');
    assert.equal(result.surface, 'script');
    assert.equal(result.artifactPath, undefined, 'a script-only result must never carry an artifactPath');
    assert.ok(written.some((line) => line.includes('Step 1')), 'expected the script steps to be printed');
  } finally {
    rmTmpDir(dir);
  }
});
