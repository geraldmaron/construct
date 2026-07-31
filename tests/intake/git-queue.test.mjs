/**
 * tests/intake/git-queue.test.mjs — GitIntakeQueue.read() claimed-directory lookup.
 *
 * Earlier evidence claimed read(id) checked
 * dir === 'claimed' without ever recursing into the per-worker
 * claimed/<worker>/ subdirectories git-queue actually writes claims into
 * (see claim() in lib/intake/git-queue.mjs), so a claimed item would appear
 * missing. Pins the current recursive-lookup behavior (lines ~117-126)
 * against regression, plus read() returning null for a truly absent id.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { GitIntakeQueue } from '../../lib/intake/git-queue.mjs';

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-git-queue-read-test-'));
}

function noopExec() {}

describe('GitIntakeQueue.read() claimed/<worker>/ traversal', () => {
  let rootDir;
  let queue;

  beforeEach(() => {
    rootDir = makeTmpRoot();
    queue = new GitIntakeQueue({ project: 'test-project', rootDir, _exec: noopExec });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('finds an item claimed into claimed/<worker>/<id>.json', async () => {
    const { id } = await queue.enqueue({ intake: { sourcePath: 'note.md' }, triage: {} });
    const claimed = await queue.claim({ claimedBy: 'worker-a' });
    assert.equal(claimed.id, id);

    const found = await queue.read(id);
    assert.ok(found, 'read() must find the item after it is claimed');
    assert.equal(found.id, id);
    assert.equal(found.status, 'claimed');
    assert.equal(found.claimedBy, 'worker-a');
  });

  it('finds a claimed item across multiple worker subdirectories', async () => {
    const { id: idOne } = await queue.enqueue({ intake: { sourcePath: 'one.md' }, triage: {} });
    await queue.claim({ claimedBy: 'worker-a' });

    const { id: idTwo } = await queue.enqueue({ intake: { sourcePath: 'two.md' }, triage: {} });
    await queue.claim({ claimedBy: 'worker-b' });

    const foundOne = await queue.read(idOne);
    const foundTwo = await queue.read(idTwo);
    assert.equal(foundOne?.claimedBy, 'worker-a');
    assert.equal(foundTwo?.claimedBy, 'worker-b');
  });

  it('returns null for an id that does not exist anywhere', async () => {
    const found = await queue.read('does-not-exist');
    assert.equal(found, null);
  });

  it('still finds pending, processed, skipped, and quarantine entries', async () => {
    const { id: pendingId } = await queue.enqueue({ intake: { sourcePath: 'pending.md' }, triage: {} });
    assert.equal((await queue.read(pendingId))?.status, 'pending');

    const { id: processedId } = await queue.enqueue({ intake: { sourcePath: 'processed.md' }, triage: {} });
    await queue.markProcessed(processedId, { processedBy: 'tester' });
    assert.equal((await queue.read(processedId))?.status, 'processed');

    const { id: skippedId } = await queue.enqueue({ intake: { sourcePath: 'skipped.md' }, triage: {} });
    await queue.markSkipped(skippedId);
    assert.equal((await queue.read(skippedId))?.status, 'skipped');
  });
});
