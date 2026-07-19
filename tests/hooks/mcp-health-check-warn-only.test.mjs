/**
 * tests/hooks/mcp-health-check-warn-only.test.mjs — PreToolUse mcp-health-check hook
 * must honor its own @maxBlockingScope none contract: warn, never block.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'mcp-health-check.mjs');
const TOOL_NAME = 'mcp__Claude_Preview__preview_click';

function runHook(fakeHome, args, stdin) {
  return spawnSync(process.execPath, [HOOK, ...args], {
    encoding: 'utf8',
    input: stdin,
    env: { ...process.env, HOME: fakeHome, CONSTRUCT_ROLES: 'off' },
  });
}

function makeFakeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-health-'));
  mkdirSync(join(dir, '.construct'), { recursive: true });
  return dir;
}

function readCache(fakeHome) {
  return JSON.parse(readFileSync(join(fakeHome, '.construct', 'mcp-health.json'), 'utf8'));
}

test('a single tool failure never blocks the next tool use (warn-only)', () => {
  const home = makeFakeHome();
  try {
    const mark = runHook(home, ['--mark-failure'], JSON.stringify({ tool_name: TOOL_NAME }));
    assert.equal(mark.status, 0);

    const pre = runHook(home, [], JSON.stringify({ tool_name: TOOL_NAME }));
    assert.equal(pre.status, 0, 'PreToolUse must exit 0 even with a recent failure');
    assert.match(pre.stderr, /failed 1 time/);
  } finally {
    rmTmpDir(home);
  }
});

test('repeated failures still never block, and never exit 2', () => {
  const home = makeFakeHome();
  try {
    for (let i = 0; i < 5; i++) {
      const mark = runHook(home, ['--mark-failure'], JSON.stringify({ tool_name: TOOL_NAME }));
      assert.equal(mark.status, 0);
    }
    const pre = runHook(home, [], JSON.stringify({ tool_name: TOOL_NAME }));
    assert.equal(pre.status, 0);
    assert.match(pre.stderr, /failed 5 times/);
  } finally {
    rmTmpDir(home);
  }
});

test('failure counter resets once the failure window has elapsed', () => {
  const home = makeFakeHome();
  try {
    const mark = runHook(home, ['--mark-failure'], JSON.stringify({ tool_name: TOOL_NAME }));
    assert.equal(mark.status, 0);

    const cachePath = join(home, '.construct', 'mcp-health.json');
    const cache = readCache(home);
    cache.Claude_Preview.since = Date.now() - 61_000;
    writeFileSync(cachePath, JSON.stringify(cache, null, 2));

    const pre = runHook(home, [], JSON.stringify({ tool_name: TOOL_NAME }));
    assert.equal(pre.status, 0);
    assert.equal(pre.stderr, '');

    const after = readCache(home);
    assert.equal(after.Claude_Preview.failures, 0);
    assert.equal(after.Claude_Preview.status, 'healthy');
  } finally {
    rmTmpDir(home);
  }
});

test('non-MCP tool calls pass through untouched', () => {
  const home = makeFakeHome();
  try {
    const pre = runHook(home, [], JSON.stringify({ tool_name: 'Read' }));
    assert.equal(pre.status, 0);
    assert.equal(pre.stdout.trim(), JSON.stringify({ tool_name: 'Read' }));
  } finally {
    rmTmpDir(home);
  }
});
