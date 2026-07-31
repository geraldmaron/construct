/**
 * tests/acceptance/modes/solo.acceptance.test.mjs — solo-mode acceptance leg.
 *
 * Proves solo mode delivers what lib/mode-capabilities.mjs's CAPABILITY_REGISTRY.solo
 * promises, with one real assertion per capability marked 'implemented' — not a
 * mock. A capability later flipped to 'implemented' without a matching entry in
 * SOLO_CAPABILITY_CHECKS fails this suite by name (parity check), so promise and
 * proof cannot drift apart silently.
 *
 * filesystem-queue: lib/intake/filesystem-queue.mjs FilesystemIntakeQueue, a real
 * enqueue -> listPending -> markProcessed round trip against an isolated tmpdir
 * (no shared state with the repo checkout).
 * local-memory / embedded-lancedb / direct-mcp: dispatchToolByName (lib/mcp/server.mjs)
 * called directly, no broker — memory_search reads the local observation store,
 * knowledge_search and storage_status read the embedded LanceDB corpus (confirmed
 * via storage_status().backend === 'lancedb' against this checkout's real index),
 * and the successful direct call itself is the direct-mcp proof.
 *
 * Run standalone:
 *   node --test tests/acceptance/modes/solo.acceptance.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemIntakeQueue } from '../../../lib/intake/filesystem-queue.mjs';
import { dispatchToolByName } from '../../../lib/mcp/server.mjs';
import { CAPABILITY_REGISTRY } from '../../../lib/mode-capabilities.mjs';
import { rmTmpDir } from '../../helpers/cleanup.mjs';

async function checkFilesystemQueue() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-solo-fs-queue-'));
  try {
    const queue = new FilesystemIntakeQueue(dir);
    const { id, route } = queue.enqueue({ intake: { sourcePath: 'fixture.md' }, triage: { confidence: 1, margin: 1 } });
    assert.equal(route, 'pending', 'fresh low-risk entry should route to pending, not quarantine');
    assert.equal(queue.count(), 1, 'enqueued entry should be counted as pending');

    const pending = queue.listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, id);

    queue.markProcessed(id, { processedBy: 'lmcp-l6-solo-acceptance' });
    assert.equal(queue.count(), 0, 'processed entry should no longer be pending');
    const record = queue.read(id);
    assert.equal(record?.status, 'processed');
  } finally {
    rmTmpDir(dir);
  }
}

async function checkLocalMemory() {
  const result = await dispatchToolByName('memory_search', { query: 'construct' });
  assert.ok(result && typeof result === 'object', 'memory_search must return an object');
  assert.ok(Array.isArray(result.observations), 'memory_search must return an observations array (even if empty)');
}

async function checkEmbeddedLanceDb() {
  const status = await dispatchToolByName('storage_status', {});
  assert.equal(status.backend, 'lancedb', `expected the embedded LanceDB backend, got: ${status.backend}`);
  assert.equal(status.status, 'healthy', `expected a healthy vector store, got: ${status.status}`);

  const search = await dispatchToolByName('knowledge_search', { query: 'construct' });
  assert.ok(search && typeof search === 'object', 'knowledge_search must return an object');
  assert.ok(Array.isArray(search.hits), 'knowledge_search must return a hits array');
}

async function checkDirectMcp() {
  const result = await dispatchToolByName('list_skills', {});
  assert.ok(Array.isArray(result?.skills), 'direct dispatchToolByName call must succeed with no broker involved');
}

const SOLO_CAPABILITY_CHECKS = {
  'filesystem-queue': checkFilesystemQueue,
  'local-memory': checkLocalMemory,
  'embedded-lancedb': checkEmbeddedLanceDb,
  'direct-mcp': checkDirectMcp,
};

test('[LMCP-L6] solo mode: every implemented capability has a passing acceptance check', async (t) => {
  const implemented = CAPABILITY_REGISTRY.solo.filter((c) => c.status === 'implemented');
  const uncovered = implemented.filter((c) => typeof SOLO_CAPABILITY_CHECKS[c.id] !== 'function').map((c) => c.id);
  assert.deepEqual(
    uncovered,
    [],
    `solo capabilities marked 'implemented' with no acceptance check (${uncovered.length}/${implemented.length}): ${uncovered.join(', ')}`,
  );

  for (const capability of implemented) {
    // eslint-disable-next-line no-await-in-loop
    await t.test(capability.id, SOLO_CAPABILITY_CHECKS[capability.id]);
  }
});
