/**
 * tests/functional/learning-loop-capture.functional.test.mjs
 *
 * Characterization tests for the learning-loop tool-miss capture (self-audit construct-rr63.9.1,
 * under the tool-contract-gate). Agent I found the capture is write-only: recordToolNameMiss
 * (lib/mcp/tool-recovery.mjs:35) appends to .cx/observations/tool-name-misses.jsonl, but a
 * repo-wide search finds no reader/aggregator that surfaces those misses. These tests pin both
 * halves: the producer writes a well-formed, appendable JSONL entry, and the module exposes no
 * consumer API. The Wave-4 follow-on (a doctor watcher / oracle action that reads the file and
 * raises beads for repeatedly-misnamed tools, plus the full session->observe->consolidate->inject
 * loop and failure capture) flips the consumer-absence assertion deliberately.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as toolRecovery from '../../lib/mcp/tool-recovery.mjs';
import { recordToolNameMiss } from '../../lib/mcp/tool-recovery.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const roots = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolmiss-'));
  roots.push(dir);
  return dir;
}
function readMisses(rootDir) {
  const file = path.join(rootDir, '.construct', 'observations', 'tool-name-misses.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
test.after(() => { for (const d of roots) { try { rmTmpDir(d); } catch {} } });

test('recordToolNameMiss writes a well-formed tool-name-miss entry', () => {
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  const misses = readMisses(rootDir);
  assert.equal(misses.length, 1, 'one miss recorded');
  const m = misses[0];
  assert.equal(m.kind, 'tool-name-miss');
  assert.equal(m.name, 'construct_call');
  assert.equal(m.recovered, 'call');
  assert.equal(typeof m.at, 'string', 'entry is timestamped');
});

test('misses accumulate as an append-only JSONL log a consumer could aggregate', () => {
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct-mcp_export', recovered: 'export' });
  recordToolNameMiss(rootDir, { name: 'unknown_tool', recovered: null });
  const misses = readMisses(rootDir);
  assert.equal(misses.length, 2, 'each miss appends a line');
  assert.deepEqual(misses.map((m) => m.name), ['construct-mcp_export', 'unknown_tool']);
});

// The tool-miss capture is consumable (construct-rr63.9.2): summarizeToolNameMisses reads and
// aggregates the JSONL by name, and learning-status surfaces the top misses. This pins that the
// consumer exists and aggregates correctly.

test('the tool-miss consumer aggregates recorded misses by name', () => {
  assert.equal(typeof toolRecovery.summarizeToolNameMisses, 'function', 'consumer export exists');
  const rootDir = root();
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  recordToolNameMiss(rootDir, { name: 'construct_call', recovered: 'call' });
  recordToolNameMiss(rootDir, { name: 'mystery_tool', recovered: null });
  const summary = toolRecovery.summarizeToolNameMisses(rootDir);
  assert.equal(summary.total, 3, 'all misses counted');
  assert.equal(summary.recovered, 2, 'recovered misses counted');
  assert.equal(summary.top[0].name, 'construct_call', 'most-missed name ranks first');
  assert.equal(summary.top[0].count, 2);
});

test('failure capture records and aggregates tool failures into a learnable anti-pattern', () => {
  assert.equal(typeof toolRecovery.recordToolFailure, 'function', 'failure capture export exists');
  const rootDir = root();
  toolRecovery.recordToolFailure(rootDir, { tool: 'ingest_document', code: 'TIMEOUT', message: 'docling timed out' });
  toolRecovery.recordToolFailure(rootDir, { tool: 'ingest_document', code: 'TIMEOUT', message: 'again' });
  toolRecovery.recordToolFailure(rootDir, { tool: 'publish_run', code: 'INVALID_INPUT', message: 'no artifact' });
  const summary = toolRecovery.summarizeToolFailures(rootDir);
  assert.equal(summary.total, 3, 'all failures counted');
  assert.equal(summary.top[0].name, 'ingest_document', 'most-failed tool ranks first');
  assert.equal(summary.top[0].count, 2);
});
