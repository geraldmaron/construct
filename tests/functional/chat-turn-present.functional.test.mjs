/**
 * tests/functional/chat-turn-present.functional.test.mjs — turn summary formatting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeToolCalls,
  summarizeSources,
  splitSourceLines,
  toolGroupLabel,
} from '../../lib/chat/tui/turn-present.mjs';

test('summarizeToolCalls groups by tool name with counts', () => {
  const groups = summarizeToolCalls([
    { id: '1', title: 'read', status: 'completed', input: { path: 'README.md' } },
    { id: '2', title: 'read', status: 'completed', input: { path: 'package.json' } },
    { id: '3', title: 'glob', status: 'completed', input: { pattern: 'docs/**' } },
  ]);
  assert.equal(groups.length, 2);
  const read = groups.find((g) => g.title === 'read');
  assert.equal(read.count, 2);
  assert.equal(toolGroupLabel(read), 'read ×2  README.md, package.json');
});

test('splitSourceLines truncates long source lists', () => {
  const refs = ['a', 'b', 'c', 'd', 'e'];
  const split = splitSourceLines(refs, { limit: 3 });
  assert.equal(split.lines.length, 3);
  assert.equal(split.hidden, 2);
});

test('summarizeSources counts by tool kind', () => {
  const src = summarizeSources([
    { tool: 'read', ref: 'a.md' },
    { tool: 'read', ref: 'b.md' },
    { tool: 'glob', ref: 'docs/**' },
  ]);
  assert.equal(src.total, 3);
  assert.equal(src.byTool.read, 2);
});
