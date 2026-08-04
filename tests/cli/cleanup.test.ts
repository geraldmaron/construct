/**
 * tests/cli/cleanup.test.ts — CLI-surface coverage for `construct cleanup`:
 * arg parsing, dry-run non-mutation, and the exit codes around --yes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCleanupArgs, cleanup } from '../../src/cli/index.ts';
import type { SpawnFn } from '../../src/kernel/cleanup/catalog.ts';

// Keeps these tests from depending on whatever docker/launchctl state
// happens to be real on the machine running them.
const NOT_FOUND_SPAWN: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });

function captureStdio<T>(fn: () => T): { result: T; out: string; err: string } {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err += chunk;
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { result, out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

test('parseCleanupArgs defaults to no flags set', () => {
  const args = parseCleanupArgs([]);
  assert.equal(args.dryRun, false);
  assert.equal(args.yes, false);
  assert.equal(args.all, false);
  assert.equal(args.keepState, false);
  assert.equal(args.withImages, false);
  assert.equal(args.scope, 'all');
});

test('parseCleanupArgs parses every flag', () => {
  const args = parseCleanupArgs([
    '--dry-run',
    '--yes',
    '--all',
    '--keep-state',
    '--with-images',
    '--scope=project',
    '--cwd=/tmp/p',
    '--home=/tmp/h',
  ]);
  assert.equal(args.dryRun, true);
  assert.equal(args.yes, true);
  assert.equal(args.all, true);
  assert.equal(args.keepState, true);
  assert.equal(args.withImages, true);
  assert.equal(args.scope, 'project');
  assert.equal(args.cwd, '/tmp/p');
  assert.equal(args.home, '/tmp/h');
});

test('parseCleanupArgs rejects an invalid scope', () => {
  assert.throws(() => parseCleanupArgs(['--scope=nope']), /Invalid --scope/);
});

test('--dry-run changes nothing on disk', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, out } = captureStdio(() => cleanup(['--dry-run', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    assert.match(out, /dry-run plan/);
    assert.ok(fs.existsSync(path.join(cwd, '.construct', 'launcher')), 'nothing removed');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('bare invocation (no --dry-run or --yes) refuses to guess and exits non-zero', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, err } = captureStdio(() => cleanup([`--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 2);
    assert.match(err, /--dry-run|--yes/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('--yes applies auto-risk removals and reports a summary', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    fs.mkdirSync(path.join(cwd, '.construct', 'launcher'), { recursive: true });
    const { result, out } = captureStdio(() => cleanup(['--yes', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    // "kept" is its own count since construct-a5q: an item the successor owns
    // ran and removed nothing, and folding it into "removed" would report a
    // deletion that did not happen.
    assert.match(out, /removed 1, kept \d+, skipped \d+\./);
    assert.equal(fs.existsSync(path.join(cwd, '.construct', 'launcher')), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('reports cleanly when nothing is detected', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-cli-cleanup-home-'));
  try {
    const { result, out } = captureStdio(() => cleanup(['--yes', `--cwd=${cwd}`, `--home=${home}`], NOT_FOUND_SPAWN));
    assert.equal(result, 0);
    assert.match(out, /no predecessor state detected/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
