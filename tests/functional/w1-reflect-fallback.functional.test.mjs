/**
 * tests/functional/w1-reflect-fallback.functional.test.mjs — Reflect summary fallback.
 *
 * Verifies the W1 behavior of `construct reflect` when --summary is omitted:
 * the CLI derives a summary from .cx/context.md plus any recent
 * session-summary observation. Tests run in a tmpdir cwd so they don't touch
 * project state.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { writeContextState } from '../../lib/context-state.mjs';
import { deriveSummaryFromContext } from '../../lib/reflect.mjs';

function freshCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-reflect-'));
  return {
    cwd,
    cleanup() { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

test('deriveSummaryFromContext returns null when no context exists', () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const result = deriveSummaryFromContext(cwd);
    assert.equal(result, null);
  } finally { cleanup(); }
});

test('deriveSummaryFromContext reads context.md compact summary', () => {
  const { cwd, cleanup } = freshCwd();
  try {
    writeContextState(cwd, {
      compact: 'Rolling out the W1 release: comment-lint extended, boundary handshake implemented, reflect fallback added.',
    });
    const result = deriveSummaryFromContext(cwd);
    assert.ok(result, 'expected a derived summary');
    assert.match(result, /W1 release/);
  } finally { cleanup(); }
});

test('deriveSummaryFromContext falls back to context.md markdown body when no compact summary', () => {
  const { cwd, cleanup } = freshCwd();
  try {
    mkdirSync(join(cwd, '.cx'), { recursive: true });
    writeFileSync(
      join(cwd, '.cx', 'context.md'),
      '# Session\n\nLast saved: 2026-05-26\n\nFocus: completing the production release plan workstreams and verifying every gate.',
    );
    const result = deriveSummaryFromContext(cwd);
    assert.ok(result, 'expected a derived summary');
    assert.match(result, /production release/);
  } finally { cleanup(); }
});

test('deriveSummaryFromContext truncates long input to a paragraph', () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const long = 'x'.repeat(2000);
    writeContextState(cwd, { compact: long });
    const result = deriveSummaryFromContext(cwd);
    assert.ok(result, 'expected a derived summary');
    assert.ok(result.length <= 600, `expected truncation, got ${result.length} chars`);
  } finally { cleanup(); }
});

test('reflect CLI auto-derives the summary when .cx/context.md exists and --summary is omitted', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    writeContextState(cwd, {
      compact: 'Verifying the W1 reflect fallback end-to-end by running the real CLI in a tmpdir.',
    });

    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'bin', 'construct'),
      'reflect',
      '--target=internal',
    ], {
      cwd,
      env: { ...process.env, HOME: cwd },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `reflect should exit 0; stderr: ${result.stderr}`);
    assert.match(result.stderr || '', /auto-derived/i, 'should announce auto-derived path');

    const internalDir = join(cwd, '.cx', 'knowledge', 'internal');
    assert.ok(existsSync(internalDir), `expected .cx/knowledge/internal/ to be created; stderr: ${result.stderr}`);
    const files = readdirSync(internalDir);
    assert.equal(files.length, 1, `expected one file in internal/, got ${files.length}`);
    const body = readFileSync(join(internalDir, files[0]), 'utf8');
    assert.match(body, /W1 reflect fallback/);
  } finally { cleanup(); }
});

test('reflect CLI exits 1 with a clear error when no context to derive from', async () => {
  const { cwd, cleanup } = freshCwd();
  try {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'bin', 'construct'),
      'reflect',
      '--target=internal',
    ], {
      cwd,
      env: { ...process.env, HOME: cwd },
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, 'should exit 1');
    assert.match(result.stderr || '', /no \.cx\/context\.md or recent session summaries/i);
  } finally { cleanup(); }
});
