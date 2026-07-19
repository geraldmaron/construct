import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_REBRAND, getRebrand } from '../lib/workspace-presets/rebrand.mjs';

test('getRebrand returns defaults without a project root', () => {
  assert.deepEqual(getRebrand(null), { ...DEFAULT_REBRAND });
});

test('getRebrand uses the configured Workspace Preset', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-rebrand-'));
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ workspacePreset: 'operations' }));
  assert.deepEqual(getRebrand(cwd), { intakeQueueLabel: 'Request queue', signalNoun: 'request' });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('retired scope files do not affect rebrand selection', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-preset-rebrand-clean-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'scope.json'), JSON.stringify({ id: 'operations' }));
  assert.equal(getRebrand(cwd).signalNoun, 'signal');
  fs.rmSync(cwd, { recursive: true, force: true });
});
