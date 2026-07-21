/**
 * Unit tests for evidence-cursor semantics in lib/sources/watch.mjs
 * (construct-4uxq0.11.1).
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  refreshWatch,
  readWatchState,
  acknowledgeSourceChange,
} from '../../lib/sources/watch.mjs';

const HOME_OVERRIDE = fs.mkdtempSync(path.join(tmpdir(), 'watch-cursor-home-'));
const PREV_HOME_OVERRIDE = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = HOME_OVERRIDE;
after(() => {
  if (PREV_HOME_OVERRIDE === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = PREV_HOME_OVERRIDE;
  fs.rmSync(HOME_OVERRIDE, { recursive: true, force: true });
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(tmpdir(), 'watch-cursor-'));
}

test('refreshWatch does not advance watermark on change until acknowledgeSourceChange', () => {
  const projectRoot = makeTempDir();
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1');

  const target = { id: 'cursor-dir', provider: 'directory', selector: { path: dir } };

  const baseline = refreshWatch(target, { projectRoot, record: false });
  assert.equal(baseline.changed, false);
  const baselineHash = baseline.current;

  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2');
  const changed = refreshWatch(target, { projectRoot, record: false });
  assert.equal(changed.changed, true);
  assert.equal(changed.pending, true);

  const pendingState = readWatchState(target, { projectRoot });
  assert.equal(pendingState.lastSeenHash, baselineHash);
  assert.equal(pendingState.pendingHash, changed.current);
  assert.notEqual(pendingState.lastSeenHash, changed.current);

  const ack = acknowledgeSourceChange(target, { projectRoot });
  assert.equal(ack.lastSeenHash, changed.current);
  assert.equal(ack.pendingHash, null);

  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
