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

const roots = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-toolmiss-'));
  roots.push(dir);
  return dir;
}
function readMisses(rootDir) {
  const file = path.join(rootDir, '.cx', 'observations', 'tool-name-misses.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
test.after(() => { for (const d of roots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

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

// The gap: the data is captured but never consumed. No reader/aggregator exists. This pins the
// write-only state so the Wave-4 consumer (doctor watcher / oracle action) is a visible addition.

test('tool-miss capture is write-only today — no consumer/reader API is exported', () => {
  const consumerNames = ['readToolNameMisses', 'aggregateToolNameMisses', 'consumeToolNameMisses', 'summarizeToolNameMisses', 'toolNameMissReport'];
  for (const name of consumerNames) {
    assert.equal(name in toolRecovery, false, `no consumer export "${name}" exists yet`);
  }
});
