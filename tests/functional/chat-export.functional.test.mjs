/**
 * tests/functional/chat-export.functional.test.mjs — plain markdown export.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportTurns } from '../../lib/chat/export.mjs';
import { createTurnBlock } from '../../lib/chat/tui/turn-block.mjs';

test('exportTurns writes plain markdown for last turn', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-export-'));
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  const turn = createTurnBlock('what is this project');
  turn.assistant = 'Construct is a meta-system for agents.';
  const result = exportTurns([{ kind: 'turn', block: turn }], { scope: 'last', cwd });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(result.path));
  const body = fs.readFileSync(result.path, 'utf8');
  assert.match(body, /## you/);
  assert.match(body, /what is this project/);
  assert.match(body, /Construct is a meta-system/);
  fs.rmSync(home, { recursive: true, force: true });
});
