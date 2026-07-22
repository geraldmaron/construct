/**
 * tests/hooks/host-coverage.test.mjs — Claude-only Layer-1 hook posture +
 * compensating controls catalog (construct-ld777).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tempDir } from '../helpers.mjs';
import {
  CONSTRUCT_WIRED_HOOK_HOSTS,
  HOST_HOOK_RESEARCH,
  COMPENSATING_CONTROLS,
  hostHookCoverageMatrix,
  detectProjectHostAdapters,
  constructShippedCursorHooksJson,
  hostsIncorrectlyMarkedHookSupported,
} from '../../lib/hooks/_lib/host-coverage.mjs';
import { checkHostHookCoverage } from '../../lib/doctor/host-hook-coverage.mjs';

test('only Claude is Construct-wired for agent lifecycle hooks', () => {
  assert.deepEqual(CONSTRUCT_WIRED_HOOK_HOSTS, ['claude']);
  assert.deepEqual(hostsIncorrectlyMarkedHookSupported(), []);
  const matrix = hostHookCoverageMatrix();
  const wired = matrix.filter((row) => row.constructWiresHooks).map((r) => r.host);
  assert.deepEqual(wired, ['claude']);
});

test('Cursor research cites official docs and declines Construct parity', () => {
  const cursor = HOST_HOOK_RESEARCH.find((r) => r.host === 'cursor');
  assert.ok(cursor);
  assert.equal(cursor.constructWires, false);
  assert.ok(cursor.urls.some((u) => u.includes('cursor.com/docs/hooks')));
  assert.ok(cursor.urls.some((u) => u.includes('third-party-hooks')));
  assert.ok(cursor.whyNotFullParity.length >= 3);
});

test('compensating controls include fail-closed Layer-2/3/4 entries', () => {
  const failClosed = COMPENSATING_CONTROLS.filter((c) => c.failClosed).map((c) => c.id);
  assert.ok(failClosed.includes('git-pre-commit'));
  assert.ok(failClosed.includes('cli-release-gates'));
  assert.ok(failClosed.includes('ci-required-checks'));
  assert.ok(failClosed.includes('mcp-broker'));
  const noticeOnly = COMPENSATING_CONTROLS.find((c) => c.id === 'cursor-rules-pointer');
  assert.equal(noticeOnly.failClosed, false);
});

test('detectProjectHostAdapters finds cursor without inventing hooks.json', () => {
  const dir = tempDir('host-coverage-');
  try {
    fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), '{}\n');
    assert.deepEqual(detectProjectHostAdapters(dir), ['cursor']);
    assert.equal(constructShippedCursorHooksJson(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor requires compensating git hooks when non-Claude hosts are present', () => {
  const dir = tempDir('host-coverage-doctor-');
  try {
    fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), '{}\n');
    fs.mkdirSync(path.join(dir, '.beads', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'hooks', 'pre-commit'), '#!/bin/sh\n');

    const unwired = checkHostHookCoverage(dir, {
      checkGitHooks: () => ({
        run: true,
        pass: false,
        label: 'Git hooks unwired (core.hooksPath unset) — Fix: git config core.hooksPath .beads/hooks',
      }),
    });
    assert.equal(unwired.pass, false);
    assert.ok(unwired.checks.some((c) => c.id === 'compensating-git-hooks' && !c.pass));

    const wired = checkHostHookCoverage(dir, {
      checkGitHooks: () => ({
        run: true,
        pass: true,
        label: 'Git hooks wired (core.hooksPath = .beads/hooks)',
      }),
    });
    assert.equal(wired.pass, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
