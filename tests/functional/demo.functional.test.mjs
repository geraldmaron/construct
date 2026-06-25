/**
 * demo.functional.test.mjs — `construct demo` smoke gate.
 *
 * @capability demo.terminal-fallback
 *
 * Contract: the `.tape` source is ALWAYS produced and the command ALWAYS
 * exits 0, whether or not a recorder binary (VHS / asciinema) is present.
 * When a recorder IS present, a recording artifact must also appear. This
 * asserts the graceful-degradation guarantee from ADR-0001 (zero-npm-core):
 * recording goes through external system binaries detected at runtime, and
 * absence degrades to source-only output rather than crashing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { locateRecorder, renderWithVhs } from '../../lib/demo.mjs';
import { loadDemoScript } from '../../lib/demo-script.mjs';
import { buildDemoAttemptChain, detectChatDemoReady } from '../../lib/demo-surface.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function run(args, cwd) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: 'utf8',
    timeout: 200_000,
    env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', CONSTRUCT_DISABLE_AUTO_CLEANUP: '1' },
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
    assert.ok(fs.existsSync(path.join(dir, '.cx', 'demos', 'tapes', 'my-demo.tape')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('construct demo: tape always produced; recording when recorder present; exit 0', () => {
  const recorder = locateRecorder();
  const cwd = recorder ? REPO : fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
  const tryCleanup = !recorder;
  try {
    const name = recorder ? 'resource-guard-rails' : 'quickstart';
    const result = run(['demo', 'record', name, '--format', 'gif'], cwd);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);

    const outDir = path.join(cwd, '.cx', 'demos');
    assert.ok(fs.existsSync(outDir), 'expected .cx/demos/ to exist');
    const files = fs.readdirSync(outDir);

    assert.ok(files.some((f) => f.endsWith('.tape')) || fs.existsSync(path.join(cwd, '.cx', 'demos', 'tapes', `${name}.tape`)),
      `expected a .tape source; got: ${files.join(', ')}`);

    if (recorder) {
      const artifacts = files.filter((f) => /\.(gif|mp4|webm|cast)$/.test(f));
      assert.ok(artifacts.length >= 1, `recorder present but no recording produced; got: ${files.join(', ')}`);
    }
  } finally {
    if (tryCleanup) fs.rmSync(cwd, { recursive: true, force: true });
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
  assert.deepEqual(calls[0], {
    binary: '/fake/vhs',
    args: ['/tmp/demo.tape'],
    options: { encoding: 'utf8', timeout: 180_000, detached: true },
  });
  assert.deepEqual(calls[1], { pid: -4242, signal: 'SIGTERM' });
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

  assert.deepEqual(calls, [{ encoding: 'utf8', timeout: 180_000, detached: false }]);
});

test('construct demo list includes shipped demo scripts', () => {
  const result = run(['demo', 'list'], REPO);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Demo scripts/);
  assert.match(result.stdout, /agentic-platforms-prd/);
});

test('loadDemoScript loads agentic-platforms-prd with five steps', () => {
  const script = loadDemoScript('agentic-platforms-prd', { cwd: REPO, repoRoot: REPO });
  assert.ok(script);
  assert.equal(script.steps.length, 5);
  assert.ok(script.fixtures.golden.includes('golden-prd-platform'));
  assert.equal(script.artifactReveal?.file, 'prd-platform.pdf');
});

test('buildDemoAttemptChain defaults to chat then tape (dashboard surface retired)', () => {
  const chain = buildDemoAttemptChain('chat', {
    script: { fallbackSurface: 'tape' },
    interactive: true,
  });
  assert.equal(chain[0], 'chat');
  assert.ok(chain.includes('tape'));
  assert.ok(!chain.includes('dashboard'));
});

test('agentic-platforms-prd tape uses the bare construct chat entry not raw Dracula shell', () => {
  const tapePath = path.join(REPO, 'templates', 'demos', 'tapes', 'agentic-platforms-prd.tape');
  const themePath = path.join(REPO, 'templates', 'demos', 'vhs', 'construct-cockpit.json');
  assert.ok(fs.existsSync(tapePath));
  assert.ok(fs.existsSync(themePath));
  const tape = fs.readFileSync(tapePath, 'utf8');
  assert.match(tape, /construct --demo=agentic-platforms-prd/);
  assert.doesNotMatch(tape, /construct chat/);
  assert.doesNotMatch(tape, /Set Theme "Dracula"/);
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));
  assert.equal(theme.name, 'Construct Cockpit');
  assert.equal(theme.cursor, '#ffffff');
});

test('detectChatDemoReady returns structured readiness', () => {
  const result = detectChatDemoReady({ env: {}, cwd: REPO });
  assert.equal(typeof result.ready, 'boolean');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('construct demo --surface=tape --source-only writes tape without chat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-src-'));
  try {
    const result = run(['demo', 'quickstart', '--surface=tape', '--source-only'], dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const files = fs.readdirSync(path.join(dir, '.cx', 'demos'));
    assert.ok(files.some((f) => f.endsWith('.tape')), `expected .tape source; got: ${files.join(', ')}`);
    assert.ok(!files.some((f) => /\.(gif|mp4|webm|cast)$/.test(f)), `--source-only should not record; got: ${files.join(', ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
