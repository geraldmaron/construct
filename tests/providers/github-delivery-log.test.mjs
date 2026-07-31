/**
 * tests/providers/github-delivery-log.test.mjs — WebhookDeliveryLog
 * persistence, retention, and fault-tolerance contract
 * (lib/providers/github/delivery-log.mjs).
 *
 * Mirrors the assurance surface of tests/writes/sent-log.test.mjs for the
 * same persistence idiom: durable reload across instances, age-window and
 * entry-cap pruning (with an injected clock, no sleeps), corrupt-line
 * tolerance on load, persist failures thrown rather than swallowed, and the
 * Default path resolving under the machine state root.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebhookDeliveryLog, DEFAULT_RETENTION_MS, DEFAULT_MAX_ENTRIES } from '../../lib/providers/github/delivery-log.mjs';

function tmpLogPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-delivery-log-'));
  return path.join(dir, 'github-deliveries.jsonl');
}

describe('WebhookDeliveryLog', () => {
  it('a recorded delivery id is found by a second instance reading the same file', () => {
    const persistPath = tmpLogPath();
    try {
      const first = new WebhookDeliveryLog({ persistPath });
      first.record({ deliveryId: 'd-1', event: 'issues' });

      const second = new WebhookDeliveryLog({ persistPath });
      const found = second.find('d-1');
      assert.equal(found.deliveryId, 'd-1');
      assert.equal(found.event, 'issues');
      assert.ok(!Number.isNaN(Date.parse(found.seenAt)));
    } finally {
      fs.rmSync(path.dirname(persistPath), { recursive: true, force: true });
    }
  });

  it('find() returns null for an unseen id', () => {
    const persistPath = tmpLogPath();
    try {
      const log = new WebhookDeliveryLog({ persistPath });
      assert.equal(log.find('never-seen'), null);
    } finally {
      fs.rmSync(path.dirname(persistPath), { recursive: true, force: true });
    }
  });

  it('records older than retentionMs are pruned on the next record, on disk and in memory', () => {
    const persistPath = tmpLogPath();
    try {
      let clock = 1_000_000;
      const log = new WebhookDeliveryLog({ persistPath, retentionMs: 500, now: () => clock });

      log.record({ deliveryId: 'old-1', event: 'push' });
      clock += 501;
      log.record({ deliveryId: 'new-1', event: 'push' });

      assert.equal(log.find('old-1'), null);
      assert.equal(log.find('new-1').deliveryId, 'new-1');
      const onDisk = fs.readFileSync(persistPath, 'utf8');
      assert.ok(!onDisk.includes('old-1'));
      assert.ok(onDisk.includes('new-1'));
    } finally {
      fs.rmSync(path.dirname(persistPath), { recursive: true, force: true });
    }
  });

  it('the entry cap evicts oldest-first when a flood of unique ids arrives inside the window', () => {
    const persistPath = tmpLogPath();
    try {
      const log = new WebhookDeliveryLog({ persistPath, maxEntries: 3 });
      for (const id of ['a', 'b', 'c', 'd']) log.record({ deliveryId: id, event: 'push' });

      assert.equal(log.size(), 3);
      assert.equal(log.find('a'), null);
      assert.equal(log.find('d').deliveryId, 'd');
    } finally {
      fs.rmSync(path.dirname(persistPath), { recursive: true, force: true });
    }
  });

  it('a corrupt JSONL line is skipped on load without losing the surrounding records', () => {
    const persistPath = tmpLogPath();
    try {
      const good1 = JSON.stringify({ deliveryId: 'g-1', event: null, seenAt: new Date().toISOString() });
      const good2 = JSON.stringify({ deliveryId: 'g-2', event: null, seenAt: new Date().toISOString() });
      fs.writeFileSync(persistPath, `${good1}\n{not json at all\n${good2}\n`, 'utf8');

      const log = new WebhookDeliveryLog({ persistPath });
      assert.equal(log.size(), 2);
      assert.equal(log.find('g-1').deliveryId, 'g-1');
      assert.equal(log.find('g-2').deliveryId, 'g-2');
    } finally {
      fs.rmSync(path.dirname(persistPath), { recursive: true, force: true });
    }
  });

  it('record() throws when the persist directory cannot be created, instead of silently dropping the dedup record', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-delivery-log-'));
    try {
      const blockerFile = path.join(dir, 'blocker');
      fs.writeFileSync(blockerFile, 'not a directory', 'utf8');
      const log = new WebhookDeliveryLog({ persistPath: path.join(blockerFile, 'deliveries.jsonl') });

      assert.throws(() => log.record({ deliveryId: 'lost-1', event: 'push' }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolvePersistPath lands under the ADR-0066 machine state root, relocated by CONSTRUCT_HOME_OVERRIDE', () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-delivery-home-'));
    const previous = process.env.CONSTRUCT_HOME_OVERRIDE;
    process.env.CONSTRUCT_HOME_OVERRIDE = fakeHome;
    try {
      const resolved = WebhookDeliveryLog.resolvePersistPath(fakeHome);
      assert.ok(resolved.startsWith(path.join(fakeHome, '.construct', 'projects')));
      assert.ok(resolved.endsWith(path.join('webhooks', 'github-deliveries.jsonl')));
    } finally {
      if (previous === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
      else process.env.CONSTRUCT_HOME_OVERRIDE = previous;
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('defaults are a bounded window and cap, not unbounded growth', () => {
    assert.equal(DEFAULT_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
    assert.equal(DEFAULT_MAX_ENTRIES, 10_000);
  });
});
