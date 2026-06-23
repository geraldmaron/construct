/**
 * tests/functional/chat-export.functional.test.mjs — plain markdown export.
 *
 * Isolation contract: isolated HOME + Construct project marker (.cx/) under the
 * fixture root; export path must remain under <fixture>/.cx/chat-sessions/exports.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportTurns } from '../../lib/chat/export.mjs';
import { createTurnBlock } from '../../lib/chat/tui/turn-block.mjs';
import { assertPathUnderRoot } from '../helpers/isolation-contract.mjs';

test('exportTurns writes plain markdown for last turn', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-export-'));
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const turn = createTurnBlock('what is this project');
  turn.assistant = 'Construct is a meta-system for agents.';
  turn.evidence = {
    schemaVersion: 1,
    status: 'verified',
    reasonCodes: ['all_recorded_evidence_cited'],
    citations: ['README.md'],
    records: [{ tool: 'read', target: 'README.md' }],
  };
  const result = exportTurns([{ kind: 'turn', block: turn }], { scope: 'last', cwd });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path));
  assertPathUnderRoot(result.path, cwd, 'export path');
  assert.ok(
    result.path.startsWith(path.join(cwd, '.cx', 'chat-sessions', 'exports')),
    `export must not fall back to user-global storage: ${result.path}`,
  );
  const body = fs.readFileSync(result.path, 'utf8');
  assert.match(body, /## you/);
  assert.match(body, /what is this project/);
  assert.match(body, /Construct is a meta-system/);
  assert.match(body, /evidence: verified/);
  assert.match(body, /sources: README.md/);
  fs.rmSync(home, { recursive: true, force: true });
});
