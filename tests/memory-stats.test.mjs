/**
 * tests/memory-stats.test.mjs — tests for lib/memory-stats.mjs.
 *
 * Verifies JSONL append, aggregate computation math, p95 latency,
 * and ablation flag handling. Isolated in a temp dir.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendSessionStats, computeStats, formatStats } from '../lib/memory-stats.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memstats-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('memory-stats', () => {
  describe('appendSessionStats', () => {
    it('creates the JSONL file and appends one line', () => {
      appendSessionStats(tmpDir, { sessionId: 'test-1', queriesIssued: 3, observationsInjected: 2, retrievalMs: 45 });
      const p = path.join(tmpDir, '.cx', 'memory-stats.jsonl');
      assert.ok(fs.existsSync(p), 'file should exist');
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]);
      assert.equal(entry.queriesIssued, 3);
      assert.equal(entry.observationsInjected, 2);
      assert.equal(entry.retrievalMs, 45);
    });

    it('appends multiple entries without overwriting', () => {
      appendSessionStats(tmpDir, { sessionId: 's1', queriesIssued: 1 });
      appendSessionStats(tmpDir, { sessionId: 's2', queriesIssued: 2 });
      const p = path.join(tmpDir, '.cx', 'memory-stats.jsonl');
      const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
      assert.equal(lines.length, 2);
    });

    it('records memoryEnabled=false for ablation sessions', () => {
      appendSessionStats(tmpDir, { sessionId: 'ab-1', queriesIssued: 0, observationsInjected: 0, memoryEnabled: false });
      const p = path.join(tmpDir, '.cx', 'memory-stats.jsonl');
      const entry = JSON.parse(fs.readFileSync(p, 'utf8').trim());
      assert.equal(entry.memoryEnabled, false);
    });
  });

  describe('computeStats', () => {
    it('returns zero-session defaults when no file exists', () => {
      const stats = computeStats(tmpDir);
      assert.equal(stats.sessions, 0);
      assert.equal(stats.hitRate, 0);
      assert.equal(stats.p95RetrievalMs, null);
    });

    it('computes averages correctly', () => {
      appendSessionStats(tmpDir, { queriesIssued: 4, observationsInjected: 3, retrievalMs: 20 });
      appendSessionStats(tmpDir, { queriesIssued: 6, observationsInjected: 1, retrievalMs: 80 });
      const stats = computeStats(tmpDir);
      assert.equal(stats.sessions, 2);
      assert.equal(stats.avgQueriesPerSession, 5);
      assert.equal(stats.avgInjectedPerSession, 2);
    });

    it('computes hit rate as fraction of sessions with injections > 0', () => {
      appendSessionStats(tmpDir, { queriesIssued: 2, observationsInjected: 1 });
      appendSessionStats(tmpDir, { queriesIssued: 1, observationsInjected: 0 });
      const stats = computeStats(tmpDir);
      assert.equal(stats.hitRate, 50);
    });

    it('computes p95 retrieval latency', () => {
      for (let i = 1; i <= 20; i++) {
        appendSessionStats(tmpDir, { queriesIssued: 1, observationsInjected: 1, retrievalMs: i * 10 });
      }
      const stats = computeStats(tmpDir);
      assert.ok(stats.p95RetrievalMs !== null, 'p95 should be non-null with latency data');
      assert.ok(stats.p95RetrievalMs >= 180, 'p95 should be near the top of the range');
    });

    it('memoryEnabledPct reflects ablation sessions', () => {
      appendSessionStats(tmpDir, { memoryEnabled: true });
      appendSessionStats(tmpDir, { memoryEnabled: false });
      appendSessionStats(tmpDir, { memoryEnabled: true });
      const stats = computeStats(tmpDir);
      assert.equal(stats.memoryEnabledPct, 67);
    });

    it('respects lastN limit', () => {
      for (let i = 0; i < 10; i++) {
        appendSessionStats(tmpDir, { queriesIssued: i + 1, observationsInjected: 0 });
      }
      const stats = computeStats(tmpDir, { lastN: 3 });
      assert.equal(stats.sessions, 3);
    });
  });

  describe('formatStats', () => {
    it('returns no-data message when sessions is 0', () => {
      const out = formatStats({ sessions: 0 });
      assert.ok(out.includes('No memory stats'), 'should indicate no data');
    });

    it('includes all key metrics in output', () => {
      appendSessionStats(tmpDir, { queriesIssued: 5, observationsInjected: 3, retrievalMs: 50 });
      const stats = computeStats(tmpDir);
      const out = formatStats(stats);
      assert.ok(out.includes('Sessions tracked'), 'should show sessions');
      assert.ok(out.includes('Hit rate'), 'should show hit rate');
      assert.ok(out.includes('retrieval'), 'should show latency');
    });
  });
});
