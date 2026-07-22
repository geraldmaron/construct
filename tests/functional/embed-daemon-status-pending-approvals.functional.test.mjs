/**
 * tests/functional/embed-daemon-status-pending-approvals.functional.test.mjs —
 * EmbedDaemon.status().pendingApprovals reflects real queue state
 * (construct-4uxq0.14.9).
 *
 * Before this fix, status() called `approvalQueue.list('pending')` — the
 * queue's real states are `awaiting_approval`/`approved`/`denied`/`expired`/
 * `executing`/`executed`; `'pending'` never occurs, so the filter always
 * returned an empty array and pendingApprovals was permanently 0 regardless
 * of queue contents. This boots a real EmbedDaemon (EMPTY_CONFIG — zero
 * sources, so ProviderRegistry.fromEnv() resolves only credential-free
 * providers, no network) over a persistPath pre-seeded with one
 * `awaiting_approval` record, and asserts the real count surfaces.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { EmbedDaemon } from '../../lib/embed/daemon.mjs';
import { EMPTY_CONFIG } from '../../lib/embed/config.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch { /* best effort */ } } });

function seedAwaitingApprovalRecord(persistPath) {
  const record = {
    approvalId: 'appr-status-test-1',
    toolCall: { tool: 'externalPost', args: {}, surface: 'test', argsHash: 'seed' },
    requestedAt: new Date().toISOString(),
    requestedBy: {},
    state: 'awaiting_approval',
    decidedAt: null,
    decidedBy: null,
    reason: null,
    resumeToken: 'seed-token',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  writeFileSync(persistPath, `${JSON.stringify(record)}\n`, 'utf8');
}

test('EmbedDaemon.status().pendingApprovals counts real awaiting_approval records, not a nonexistent "pending" state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-status-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  const persistPath = join(root, 'queue.jsonl');
  seedAwaitingApprovalRecord(persistPath);

  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    rootDir: root,
    workspaceDir: root,
    persistPath,
    env: { ...process.env, CONSTRUCT_EMBEDDING_MODEL: 'hashing' },
  });

  try {
    await daemon.start();
    const status = daemon.status();
    assert.equal(status.pendingApprovals, 1, 'the seeded awaiting_approval record must be counted');
  } finally {
    daemon.stop();
  }
});

test('EmbedDaemon.status().pendingApprovals is 0 for an empty queue', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cx-embed-daemon-status-'));
  dirs.push(root);
  mkdirSync(join(root, '.construct'), { recursive: true });
  const persistPath = join(root, 'queue.jsonl');

  const daemon = new EmbedDaemon({
    config: EMPTY_CONFIG,
    rootDir: root,
    workspaceDir: root,
    persistPath,
    env: { ...process.env, CONSTRUCT_EMBEDDING_MODEL: 'hashing' },
  });

  try {
    await daemon.start();
    const status = daemon.status();
    assert.equal(status.pendingApprovals, 0);
  } finally {
    daemon.stop();
  }
});
