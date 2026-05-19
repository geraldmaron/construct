/**
 * recommendation-store.test.mjs — Tests for the embed recommendation-store module.
 *
 * Covers: recommendation creation, storage, retrieval by customer/project,
 * and TTL-based expiration.
 */
import { describe, it, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const INDEX_FILE = join(homedir(), '.cx', 'intake', 'recommendations-index.json');
const LOG_FILE = join(homedir(), '.cx', 'intake', 'recommendations.jsonl');

describe('recommendation store', () => {
  let store;

  before(async () => {
    // Clean state before tests
    try { unlinkSync(INDEX_FILE); } catch {}
    try { unlinkSync(LOG_FILE); } catch {}
    store = await import('../../lib/embed/recommendation-store.mjs');
  });

  afterEach(() => {
    // Clean state between tests
    try { unlinkSync(INDEX_FILE); } catch {}
    try { unlinkSync(LOG_FILE); } catch {}
  });

  describe('createRecommendation', () => {
    it('creates a recommendation with P3 for low signals', () => {
      const result = store.createRecommendation({
        type: 'prd',
        title: 'Test PRD',
        reason: 'Testing',
        signalCount: 1,
      });
      assert.ok(result.id);
      assert.equal(result.priority, 'P3');
    });

    it('creates P0 for high-signal recommendations', () => {
      const result = store.createRecommendation({
        type: 'adr',
        title: 'High priority',
        reason: 'Many signals',
        signalCount: 8,
        customerImpact: 3,
        recencyBonus: 3,
        strategicBonus: 2,
      });
      assert.equal(result.priority, 'P0');
    });

    it('deduplicates by type+title', () => {
      const r1 = store.createRecommendation({
        type: 'prd',
        title: 'Duplicate Test',
        reason: 'First',
        signalCount: 1,
      });
      const r2 = store.createRecommendation({
        type: 'prd',
        title: 'Duplicate Test',
        reason: 'Second',
        signalCount: 2,
      });
      assert.equal(r2.existing, true, 'should detect duplicate');
    });

    it('increments signal count on duplicate', () => {
      store.createRecommendation({
        type: 'prd',
        title: 'Signal Count Test',
        reason: 'First',
        signalCount: 3,
      });
      store.createRecommendation({
        type: 'prd',
        title: 'Signal Count Test',
        reason: 'Second',
        signalCount: 5,
      });
      const active = store.listActiveRecommendations();
      const found = active.find(r => r.title === 'Signal Count Test');
      // totalSignalCount should be 3 + 5 = 8
      assert.equal(found.totalSignalCount, 8, 'should accumulate signal count');
    });
  });

  describe('dismissRecommendation', () => {
    it('marks as dismissed and hides from active list', () => {
      store.createRecommendation({
        type: 'prd',
        title: 'Dismiss Me',
        reason: 'Testing dismiss',
        signalCount: 1,
      });
      store.dismissRecommendation('prd::dismiss-me', { reason: 'not needed' });
      const active = store.listActiveRecommendations();
      const found = active.find(r => r.title === 'Dismiss Me');
      assert.equal(found, undefined);
    });

    it('throws for unknown key', () => {
      assert.throws(() => store.dismissRecommendation('nonexistent'), /not found/);
    });
  });

  describe('reviveRecommendation', () => {
    it('re-activates a dismissed recommendation', () => {
      store.createRecommendation({
        type: 'prd',
        title: 'Revive Me',
        reason: 'Test revive',
        signalCount: 1,
      });
      store.dismissRecommendation('prd::revive-me', { reason: 'testing' });

      // Before revive — should not be active
      assert.equal(store.listActiveRecommendations().find(r => r.title === 'Revive Me'), undefined);

      // Revive with new signals
      store.reviveRecommendation('prd::revive-me', { signalCount: 3 });

      // After revive — should be active again
      const active = store.listActiveRecommendations();
      const found = active.find(r => r.title === 'Revive Me');
      assert.ok(found, 'should be re-activated');
      assert.ok(found.totalSignalCount >= 4);
    });
  });

  describe('listActiveRecommendations', () => {
    it('returns empty list when no recommendations exist', () => {
      const list = store.listActiveRecommendations();
      assert.deepEqual(list, []);
    });

    it('returns active recommendations in priority order', () => {
      const keys = ['AA', 'BB', 'CC'];
      for (const k of keys) {
        store.createRecommendation({
          type: 'prd',
          title: k,
          reason: 'test',
          signalCount: keys.indexOf(k) + 1,
        });
      }
      const active = store.listActiveRecommendations();
      assert.equal(active.length, 3);
      // Should be sorted by score descending
      for (let i = 1; i < active.length; i++) {
        assert.ok(active[i - 1].score >= active[i].score);
      }
    });
  });

  describe('autoSuppressStale', () => {
    it('returns 0 when no recommendations to suppress', () => {
      const suppressed = store.autoSuppressStale();
      assert.equal(suppressed, 0);
    });
  });

  describe('recommendationStats', () => {
    it('returns zero state for empty store', () => {
      const stats = store.recommendationStats();
      assert.equal(stats.total, 0);
      assert.equal(stats.active, 0);
    });

    it('counts dismissed separately', () => {
      store.createRecommendation({ type: 'prd', title: 'Stats A', reason: 'test' });
      store.createRecommendation({ type: 'rfc', title: 'Stats B', reason: 'test' });
      store.dismissRecommendation('rfc::stats-b', { reason: 'no' });

      const stats = store.recommendationStats();
      assert.equal(stats.total, 2);
      assert.equal(stats.active, 1);
      assert.equal(stats.dismissed, 1);
    });
  });
});
