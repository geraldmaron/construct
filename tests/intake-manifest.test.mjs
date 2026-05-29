/**
 * tests/intake-manifest.test.mjs — SHA-256 dedup manifest unit tests.
 *
 * Asserts the empty-manifest contract, deterministic sha256 hashing,
 * idempotent record + load, and corrupted-file recovery.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadManifest,
  saveManifest,
  recordFile,
  hasFile,
  sha256Of,
  manifestStats,
  MANIFEST_VERSION,
  MANIFEST_REL_PATH,
} from '../lib/intake/manifest.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'manifest-test-'));
  mkdirSync(join(projectRoot, '.cx', 'intake'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

test('loadManifest returns an empty manifest when none exists', () => {
  const m = loadManifest(projectRoot);
  assert.equal(m.version, MANIFEST_VERSION);
  assert.deepEqual(m.files, {});
});

test('sha256Of is deterministic for the same buffer', () => {
  const buf = Buffer.from('hello world', 'utf8');
  const a = sha256Of(buf);
  const b = sha256Of(buf);
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('recordFile then hasFile round-trips and saveManifest persists', () => {
  const sha = sha256Of(Buffer.from('notes\n', 'utf8'));
  const entry = recordFile(projectRoot, sha, {
    sourcePath: 'inbox/notes.md',
    intakeId: 'intake-123',
    createdBy: 'Test <test@example.com>',
    createdByAgent: 'claude-opus-4-7',
  });
  assert.equal(entry.sourcePath, 'inbox/notes.md');
  assert.equal(entry.createdByAgent, 'claude-opus-4-7');
  assert.equal(hasFile(projectRoot, sha), true);
  assert.equal(hasFile(projectRoot, 'not-a-real-hash'), false);

  const reloaded = loadManifest(projectRoot);
  assert.deepEqual(reloaded.files[sha], entry);
});

test('recordFile is idempotent — same sha overwrites without growing the map', () => {
  const sha = sha256Of(Buffer.from('content', 'utf8'));
  recordFile(projectRoot, sha, { sourcePath: 'inbox/a.md', intakeId: 'one' });
  recordFile(projectRoot, sha, { sourcePath: 'inbox/a.md', intakeId: 'two' });

  const stats = manifestStats(projectRoot);
  assert.equal(stats.total, 1);
  const reloaded = loadManifest(projectRoot);
  assert.equal(reloaded.files[sha].intakeId, 'two');
});

test('loadManifest recovers from a corrupted manifest file by returning empty', () => {
  const p = join(projectRoot, MANIFEST_REL_PATH);
  writeFileSync(p, '{not valid json', 'utf8');
  const m = loadManifest(projectRoot);
  assert.equal(m.version, MANIFEST_VERSION);
  assert.deepEqual(m.files, {});
});

test('saveManifest creates the .cx/intake directory if absent', () => {
  rmSync(join(projectRoot, '.cx', 'intake'), { recursive: true, force: true });
  saveManifest(projectRoot, { version: 1, files: {} });
  assert.ok(existsSync(join(projectRoot, MANIFEST_REL_PATH)));
});

test('recordFile rejects an empty sha', () => {
  assert.throws(() => recordFile(projectRoot, '', { sourcePath: 'x' }), /sha is required/);
});
