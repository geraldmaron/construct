/**
 * tests/oracle-approval-dedupe.test.mjs — oracle pending-queue dedupe and retention.
 *
 * Covers stable enqueue deduplication plus TTL/cap expiry so repeated oracle ticks do not
 * grow unbounded duplicate approval rows.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { listPending, runOracleTick } from '../lib/oracle/actions.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-queue-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-queue-home-'));
  mkdirSync(join(projectDir, '.construct'), { recursive: true });
  mkdirSync(join(homeDir, '.cx'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir: process.cwd(),
    cleanup() {
      for (const dir of [projectDir, homeDir]) {
        try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
      }
    },
  };
}

function pendingFile(projectDir) {
  return join(projectDir, '.construct', 'oracle', 'pending.jsonl');
}

function readRows(projectDir) {
  return readFileSync(pendingFile(projectDir), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('runOracleTick dedupes identical approve actions and refreshes occurrence metadata', async () => {
  const env = freshProject();
  try {
    writeFileSync(join(env.projectDir, '.construct', 'contract-violations.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      contractId: 'test-contract',
      agent: 'engineer',
    }) + '\n');

    const first = await runOracleTick({ ...env, dryRun: false });
    const firstPending = listPending(env.projectDir);
    assert.equal(first.tick.queued.length > 0, true);
    assert.equal(firstPending.length > 0, true);

    const second = await runOracleTick({ ...env, dryRun: false });
    const secondPending = listPending(env.projectDir);
    assert.equal(second.tick.queued.length, first.tick.queued.length);
    assert.equal(secondPending.length, firstPending.length, 'identical tick should not grow unique pending count');

    const duplicated = secondPending.find((row) => row.count > 1);
    assert.ok(duplicated, 'at least one repeated decision should accumulate count instead of duplicate rows');
    assert.ok(Date.parse(duplicated.lastSeenAt) >= Date.parse(duplicated.firstSeenAt));
  } finally {
    env.cleanup();
  }
});

test('listPending expires stale rows and enforces the queue cap', () => {
  const env = freshProject();
  try {
    mkdirSync(join(env.projectDir, '.construct', 'oracle'), { recursive: true });
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 55; i++) {
      rows.push({
        id: `oracle-${i}`,
        dedupKey: `oracle:key-${i}`,
        kind: 'worker-profile-review',
        summary: `Review item ${i}`,
        status: 'pending',
        queuedAt: new Date(now - i * 1000).toISOString(),
        firstSeenAt: new Date(now - i * 1000).toISOString(),
        lastSeenAt: new Date(now - i * 1000).toISOString(),
        count: 1,
      });
    }
    rows.push({
      id: 'oracle-stale',
      dedupKey: 'oracle:stale',
      kind: 'worker-profile-review',
      summary: 'Expired item',
      status: 'pending',
      queuedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
      firstSeenAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
      lastSeenAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
      count: 1,
    });
    writeFileSync(pendingFile(env.projectDir), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');

    const visible = listPending(env.projectDir, { now });
    assert.ok(visible.length <= 50, 'pending view should never exceed the cap');

    const allRows = readRows(env.projectDir);
    const stale = allRows.find((row) => row.id === 'oracle-stale');
    assert.equal(stale.status, 'expired');
    assert.equal(stale.expiredReason, 'ttl');

    const capExpired = allRows.filter((row) => row.expiredReason === 'cap');
    assert.ok(capExpired.length >= 5, 'oldest overflow rows should expire when the cap is exceeded');
  } finally {
    env.cleanup();
  }
});
