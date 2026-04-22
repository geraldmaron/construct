/**
 * tests/approve.test.mjs — tests for lib/approve.mjs marker lifecycle.
 *
 * Covers writeMarker/readMarker/consumeMarker/revokeAll end-to-end, TTL
 * expiry, count decrement to zero, branch scoping, and unknown-action
 * rejection. Isolates against a temp HOME so real ~/.cx/approvals is
 * not touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Swap HOME before importing approve.mjs so APPROVAL_DIR resolves to temp.
const TMP_HOME = mkdtempSync(join(tmpdir(), 'construct-approve-test-'));
const PREV_HOME = process.env.HOME;
process.env.HOME = TMP_HOME;

const mod = await import('../lib/approve.mjs');
const { writeMarker, readMarker, consumeMarker, revokeAll, listMarkers, APPROVABLE_ACTIONS } = mod;

function cleanup() {
  try { rmSync(TMP_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', () => {
  process.env.HOME = PREV_HOME;
  cleanup();
});

function resetApprovalDir() {
  const dir = join(TMP_HOME, '.cx', 'approvals');
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  mkdirSync(dir, { recursive: true });
}

test('approve: writeMarker + readMarker round-trip', () => {
  resetApprovalDir();
  const marker = writeMarker('commit', { count: 2, reason: 'test' });
  assert.equal(marker.action, 'commit');
  assert.equal(marker.remainingCount, 2);
  assert.equal(marker.reason, 'test');

  const read = readMarker('commit');
  assert.equal(read.remainingCount, 2);
  assert.equal(read.reason, 'test');
});

test('approve: readMarker returns null when none exists', () => {
  resetApprovalDir();
  assert.equal(readMarker('commit'), null);
});

test('approve: consumeMarker decrements count and deletes at zero', () => {
  resetApprovalDir();
  writeMarker('push', { count: 2 });

  assert.equal(consumeMarker('push'), true);
  assert.equal(readMarker('push').remainingCount, 1);

  assert.equal(consumeMarker('push'), true);
  assert.equal(readMarker('push'), null, 'marker deleted after final consume');
});

test('approve: consumeMarker returns false when no marker', () => {
  resetApprovalDir();
  assert.equal(consumeMarker('commit'), false);
});

test('approve: expired marker is auto-cleaned on read', () => {
  resetApprovalDir();
  // Write a marker in the past
  const path = join(TMP_HOME, '.cx', 'approvals', 'commit.json');
  const past = new Date(Date.now() - 60_000).toISOString();
  writeFileSync(path, JSON.stringify({
    action: 'commit',
    createdAt: past,
    expiresAt: past,
    remainingCount: 1,
  }));
  assert.equal(readMarker('commit'), null, 'expired marker cleaned');
  assert.equal(existsSync(path), false);
});

test('approve: revokeAll clears all markers', () => {
  resetApprovalDir();
  writeMarker('commit');
  writeMarker('push');
  writeMarker('merge');
  const cleared = revokeAll();
  assert.equal(cleared, 3);
  assert.equal(listMarkers().length, 0);
});

test('approve: writeMarker rejects unknown action', () => {
  resetApprovalDir();
  assert.throws(() => writeMarker('deploy'), /Unknown approvable action/);
});

test('approve: APPROVABLE_ACTIONS covers commit, push, merge', () => {
  assert.deepEqual(new Set(APPROVABLE_ACTIONS), new Set(['commit', 'push', 'merge']));
});

test('approve: branch scope is persisted in marker', () => {
  resetApprovalDir();
  const marker = writeMarker('commit', { branch: 'fix/thing' });
  assert.equal(marker.branch, 'fix/thing');
  const read = readMarker('commit');
  assert.equal(read.branch, 'fix/thing');
});
