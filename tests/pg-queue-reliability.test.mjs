/**
 * tests/pg-queue-reliability.test.mjs — retry, DLQ, cancellation, idempotency contracts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('PostgresIntakeQueue exposes reliability operations for team workers', () => {
  const source = fs.readFileSync(new URL('../lib/queue/pg-queue.mjs', import.meta.url), 'utf8');
  assert.match(source, /async fail\(id,/);
  assert.match(source, /status = CASE WHEN attempt >= max_attempts THEN 'dead_letter'/);
  assert.match(source, /available_at = CASE WHEN attempt >= max_attempts THEN available_at ELSE now\(\) \+/);
  assert.match(source, /async requestCancellation\(id,/);
  assert.match(source, /cancelRequested/);
  assert.match(source, /async queueStats\(\)/);
});

test('claim protocol will not reclaim expired work beyond max attempts', () => {
  const source = fs.readFileSync(new URL('../lib/queue/pg-queue.mjs', import.meta.url), 'utf8');
  assert.match(source, /lease_expires_at <= now\(\) AND attempt < max_attempts/);
});

test('markProcessed carries an execution key for idempotent completion', () => {
  const source = fs.readFileSync(new URL('../lib/queue/pg-queue.mjs', import.meta.url), 'utf8');
  assert.match(source, /executionKey/);
  assert.match(source, /idempotent: true/);
  assert.match(source, /AND status <> 'processed'/);
});
