/**
 * tests/functional/playwright-demo-recording.functional.test.mjs — recording spawn
 * and artifact-selection regression guard for lib/playwright-demo.mjs.
 *
 * Proves two fixes: (1) recording spawns the locally resolved Playwright CLI
 * binary directly, never `npx` (a missing local install fails closed instead of
 * falling through to registry auto-install); (2) the produced video is selected
 * by a before/after snapshot diff against the run's own dirs, never bare
 * newest-mtime, so a stale file with a mtime forced ahead of the real output is
 * not misattributed as this run's artifact.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recordPlaywrightDemo } from '../../lib/playwright-demo.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function makeWorkspace({ withPlaywrightPackage }) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-demo-fn-'));
  fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ name: 'demo-workspace' }, null, 2));
  fs.writeFileSync(path.join(repoRoot, 'playwright.config.mjs'), 'export default {};\n');
  const specDir = path.join(repoRoot, 'specs');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'tour.spec.ts'), 'export {};\n');

  if (withPlaywrightPackage) {
    const pkgDir = path.join(repoRoot, 'node_modules', '@playwright', 'test');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: '@playwright/test',
      bin: { playwright: 'cli.js' },
    }, null, 2));
    fs.writeFileSync(path.join(pkgDir, 'cli.js'), '#!/usr/bin/env node\n');
  }

  return { repoRoot };
}

test('recordPlaywrightDemo spawns the resolved local binary directly, never npx', () => {
  const { repoRoot } = makeWorkspace({ withPlaywrightPackage: true });
  try {
    const calls = [];
    const spawn = (command, args, opts) => {
      calls.push({ command, args, opts });
      const testResultsDir = path.join(repoRoot, 'test-results');
      fs.mkdirSync(testResultsDir, { recursive: true });
      fs.writeFileSync(path.join(testResultsDir, 'run.webm'), 'fresh-video');
      return { status: 0, stdout: '', stderr: '', signal: null };
    };

    const result = recordPlaywrightDemo({
      name: 'tour',
      workspace: '.',
      spec: 'specs/tour.spec.ts',
      output: { format: 'webm' },
    }, { cwd: repoRoot, repoRoot, spawn });

    assert.equal(result.ok, true, result.message);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, process.execPath);
    assert.ok(calls[0].args[0].endsWith('cli.js'));
    assert.ok(calls[0].args[0].includes(path.join('node_modules', '@playwright', 'test')));
    assert.equal(calls[0].args[1], 'test');
    assert.ok(!calls.some((c) => c.command === 'npx'));
  } finally {
    rmTmpDir(repoRoot);
  }
});

test('recordPlaywrightDemo fails closed without spawning npx when @playwright/test is not installed', () => {
  const { repoRoot } = makeWorkspace({ withPlaywrightPackage: false });
  try {
    let spawnCalled = false;
    const spawn = () => {
      spawnCalled = true;
      return { status: 0, stdout: '', stderr: '', signal: null };
    };

    const result = recordPlaywrightDemo({
      name: 'tour',
      workspace: '.',
      spec: 'specs/tour.spec.ts',
    }, { cwd: repoRoot, repoRoot, spawn });

    assert.equal(result.ok, false);
    assert.ok(result.message.includes('@playwright/test'), result.message);
    assert.equal(spawnCalled, false);
  } finally {
    rmTmpDir(repoRoot);
  }
});

test('artifact selection ignores a stale pre-existing video even with a mtime forced ahead of the run', () => {
  const { repoRoot } = makeWorkspace({ withPlaywrightPackage: true });
  try {
    const testResultsDir = path.join(repoRoot, 'test-results');
    fs.mkdirSync(testResultsDir, { recursive: true });
    const stalePath = path.join(testResultsDir, 'stale.webm');
    fs.writeFileSync(stalePath, 'stale-video');
    const future = Date.now() + 60_000;
    fs.utimesSync(stalePath, future / 1000, future / 1000);

    const spawn = () => {
      fs.writeFileSync(path.join(testResultsDir, 'fresh.webm'), 'fresh-video');
      return { status: 0, stdout: '', stderr: '', signal: null };
    };

    const result = recordPlaywrightDemo({
      name: 'tour',
      workspace: '.',
      spec: 'specs/tour.spec.ts',
      output: { format: 'webm' },
    }, { cwd: repoRoot, repoRoot, spawn });

    assert.equal(result.ok, true, result.message);
    assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'fresh-video');
  } finally {
    rmTmpDir(repoRoot);
  }
});
