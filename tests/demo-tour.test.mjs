/**
 * tests/demo-tour.test.mjs — guided demo tour: linear renderer + accessible path.
 *
 * Exercises the WCAG-plain tour two ways: the renderer in isolation (color on/off,
 * step framing, headless auto-advance) and the real `construct demo tour` binary
 * end-to-end. The binary runs with --accessible --skip-input so it stays
 * non-interactive and CI-safe, and the test asserts the accessible output carries
 * no ANSI escape sequences.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderTour } from '../lib/demo-tour-renderer.mjs';
import { loadDemoScript, listDemoScripts } from '../lib/demo-script.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'construct');

// The `construct demo tour` binary spawns below share one sandboxed HOME so
// the run never touches the real developer machine's ~/.construct/projects/
// (ADR-0066 machine-scoped state root).

let HOME;
before(() => { HOME = mkdtempSync(path.join(os.tmpdir(), 'demo-tour-home-')); });
after(() => { rmSync(HOME, { recursive: true, force: true }); });

const ANSI = /\[[0-9;]*m/;

function collectOutput({ isTTY = false } = {}) {
  const chunks = [];
  return {
    stream: { write: (s) => { chunks.push(s); return true; }, isTTY },
    text: () => chunks.join(''),
  };
}

const SAMPLE_SCRIPT = {
  name: 'sample-tour',
  title: 'Sample tour',
  summary: 'Two steps to prove the linear renderer.',
  steps: [
    { title: 'Plan', prompt: 'Plan the work', command: 'node bin/construct plan "x"' },
    { title: 'Build', prompt: 'Build it', command: 'node bin/construct build' },
  ],
};

test('renderTour accessible path emits numbered steps and no ANSI color', async () => {
  const out = collectOutput();
  const result = await renderTour({
    script: SAMPLE_SCRIPT,
    output: out.stream,
    accessible: true,
    skipInput: true,
  });
  const text = out.text();
  assert.equal(result.ok, true);
  assert.equal(result.steps, 2);
  assert.equal(result.accessible, true);
  assert.ok(text.includes('Demo tour: Sample tour'));
  assert.ok(text.includes('Step 1 of 2: Plan'));
  assert.ok(text.includes('Step 2 of 2: Build'));
  assert.ok(text.includes('node bin/construct plan "x"'));
  assert.ok(text.includes('Tour complete.'));
  assert.ok(!ANSI.test(text), 'accessible output must contain no ANSI escape sequences');
});

test('renderTour emits ANSI on a color-capable TTY', async () => {
  const out = collectOutput({ isTTY: true });
  await renderTour({
    script: SAMPLE_SCRIPT,
    output: out.stream,
    color: true,
    skipInput: true,
    env: { TERM: 'xterm-256color' },
  });
  assert.ok(ANSI.test(out.text()), 'color path should emit ANSI sequences on a TTY');
});

test('renderTour reports failure for a missing script', async () => {
  const out = collectOutput();
  const result = await renderTour({ script: null, output: out.stream, skipInput: true });
  assert.equal(result.ok, false);
  assert.equal(result.steps, 0);
});

test('shipped demo script loads and tours headlessly', async () => {
  const names = listDemoScripts({ cwd: REPO, repoRoot: REPO });
  assert.ok(names.length > 0, 'expected at least one shipped demo script');
  const script = loadDemoScript(names[0], { cwd: REPO, repoRoot: REPO });
  assert.ok(script);
  const out = collectOutput();
  const result = await renderTour({ script, output: out.stream, accessible: true, skipInput: true });
  assert.equal(result.ok, true);
  assert.equal(result.steps, script.steps.length);
});

test('construct demo tour --accessible runs end-to-end and is WCAG-plain', () => {
  const proc = spawnSync('node', [BIN, 'demo', 'tour', '--accessible', '--skip-input'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME, CX_HOME_OVERRIDE: HOME },
  });
  assert.equal(proc.status, 0, `exit 0 expected, got ${proc.status}: ${proc.stderr}`);
  assert.ok(proc.stdout.includes('Demo tour:'), 'tour header missing');
  assert.ok(/Step 1 of \d+/.test(proc.stdout), 'numbered step missing');
  assert.ok(proc.stdout.includes('Tour complete.'), 'completion line missing');
  assert.ok(!ANSI.test(proc.stdout), 'accessible binary output must contain no ANSI color codes');
});

test('construct demo tour accepts an explicit demo name', () => {
  const names = listDemoScripts({ cwd: REPO, repoRoot: REPO });
  const proc = spawnSync('node', [BIN, 'demo', 'tour', names[0], '--accessible', '--skip-input'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME, CX_HOME_OVERRIDE: HOME },
  });
  assert.equal(proc.status, 0, `exit 0 expected, got ${proc.status}: ${proc.stderr}`);
  const script = loadDemoScript(names[0], { cwd: REPO, repoRoot: REPO });
  assert.ok(proc.stdout.includes(`Demo tour: ${script.title}`));
});

test('construct demo tour rejects an unknown name', () => {
  const proc = spawnSync('node', [BIN, 'demo', 'tour', 'no-such-demo-xyz', '--accessible', '--skip-input'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME, CX_HOME_OVERRIDE: HOME },
  });
  assert.notEqual(proc.status, 0, 'unknown demo should exit non-zero');
  assert.ok(/Unknown demo/.test(proc.stderr), 'expected an unknown-demo message on stderr');
});
