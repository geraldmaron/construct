/**
 * tests/context-state.test.mjs — context state prefers JSON and preserves markdown compatibility
 *
 * Tests the context-state module that loads and writes .cx/context.json and .cx/context.md.
 * Verifies JSON takes precedence over markdown, field preservation, and round-trip compatibility.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readContextState, writeContextState } from '../lib/context-state.mjs';

test('context state prefers JSON and preserves markdown compatibility', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-context-state-'));
  const payload = { source: 'test', activeWork: ['A'] };
  const markdown = '# Session Context\n\n## Active Work\n- A\n';

  writeContextState(root, payload, { markdown });

  const state = readContextState(root);
  assert.equal(state.format, 'json');
  assert.equal(state.source, 'test');
  assert.deepEqual(state.activeWork, ['A']);
  assert.equal(fs.existsSync(path.join(root, '.cx', 'context.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.cx', 'context.md')), true);
});
