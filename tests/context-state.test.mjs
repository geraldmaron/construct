/**
 * tests/context-state.test.mjs — context state prefers JSON and preserves markdown compatibility
 *
 * Tests the context-state module that loads and writes .construct/context.json and .construct/context.md.
 * Verifies JSON takes precedence over markdown, field preservation, and round-trip compatibility.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectContextState, readContextState, writeContextState } from '../lib/context-state.mjs';

test('context state prefers JSON and preserves markdown compatibility', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-context-state-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  const payload = { source: 'test', activeWork: ['A'] };
  const markdown = '# Session Context\n\n## Active Work\n- A\n';

  writeContextState(root, payload, { markdown });

  const state = readContextState(root);
  assert.equal(state.format, 'json');
  assert.equal(state.source, 'test');
  assert.deepEqual(state.activeWork, ['A']);
  assert.equal(fs.existsSync(path.join(root, '.construct', 'context.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.construct', 'context.md')), true);
});

test('inspectContextState attaches context.md body when JSON lacks markdown', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-context-attach-'));
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
  const constructDir = path.join(root, '.construct');
  fs.mkdirSync(constructDir, { recursive: true });
  fs.writeFileSync(path.join(constructDir, 'context.json'), JSON.stringify({
    format: 'json',
    source: 'construct-init',
    projectName: 'attach-test',
    activeWork: [],
  }, null, 2));
  fs.writeFileSync(path.join(constructDir, 'context.md'), '# Project Context\n\n## What was in progress\nHermetic attach check\n');

  const inspection = inspectContextState(root);
  assert.equal(inspection.hasFile, true);
  assert.equal(inspection.source, 'json');
  assert.match(inspection.state.markdown, /Hermetic attach check/);
});
