/**
 * tests/acceptance/modes/team.acceptance.test.mjs — LMCP-L6 team-mode acceptance leg.
 *
 * Proves team mode delivers what lib/mode-capabilities.mjs's CAPABILITY_REGISTRY.team
 * promises, against a real Postgres — not the mocked `sql` clients
 * tests/pg-queue-reliability.test.mjs / tests/worker-runtime.test.mjs use, and not
 * dev/team-harness/verify.sh's own `node --test` step (same mocks). Self-skips
 * (does not fail) when neither DATABASE_URL nor CONSTRUCT_DATABASE_URL is set, so
 * a machine without Postgres stays green on the default `npm test` sweep; the
 * dedicated 'team mode acceptance (postgres)' CI job (.github/workflows/ci.yml)
 * supplies a Postgres service container so this leg runs for real there.
 *
 * postgres-queue: two independent worker identities race PostgresIntakeQueue.claim()
 * (lib/queue/pg-queue.mjs) against a shared queue of real rows — the
 * `FOR UPDATE SKIP LOCKED` claim protocol is proven, not just source-grepped, by
 * checking every enqueued item is claimed by exactly one worker and none twice.
 * worker-heartbeat: two WorkerRegistry (lib/orchestration/worker-runtime.mjs)
 * identities register and heartbeat against the same real worker table and both
 * are visible in list() at once — the "two workers ... share traces" acceptance
 * language, made concrete as shared registry visibility.
 *
 * Deferred (see LMCP-L6 bead notes): shared-memory / central-telemetry /
 * brokered-mcp are 'stub' and docker-workers is 'not-implemented' in
 * CAPABILITY_REGISTRY.team — no acceptance check is expected for those yet; this
 * suite asserts they have NOT silently flipped to 'implemented' behind this
 * guard's back.
 *
 * Run standalone (requires a reachable Postgres):
 *   DATABASE_URL=postgres://... node --test tests/acceptance/modes/team.acceptance.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSqlClient, closeSqlClient } from '../../../lib/storage/backend.mjs';
import { applyMigrations } from '../../../lib/db/migrate.mjs';
import { PostgresIntakeQueue } from '../../../lib/queue/pg-queue.mjs';
import { WorkerRegistry } from '../../../lib/orchestration/worker-runtime.mjs';
import { CAPABILITY_REGISTRY } from '../../../lib/mode-capabilities.mjs';

const PROJECT = `lmcp-l6-team-acceptance-${process.pid}`;

function hasDatabaseUrl() {
  return Boolean((process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL || '').trim());
}

async function checkPostgresQueue(sql) {
  const queueName = `lmcp-l6-${Date.now()}`;
  const queue = new PostgresIntakeQueue({ sql, project: PROJECT, tenantId: 'local', queueName });
  await queue.ensureSchema();

  const ITEM_COUNT = 6;
  const enqueued = [];
  for (let i = 0; i < ITEM_COUNT; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { id } = await queue.enqueue({ intake: { sourcePath: `fixture-${i}.md` } });
    enqueued.push(id);
  }
  assert.equal(await queue.count(), ITEM_COUNT);

  const claimedBy = { 'worker-a': [], 'worker-b': [] };
  const workers = ['worker-a', 'worker-b'];
  for (let round = 0; round < ITEM_COUNT; round += 1) {
    const worker = workers[round % workers.length];
    // eslint-disable-next-line no-await-in-loop
    const claimed = await queue.claim({ claimedBy: worker });
    assert.ok(claimed, `expected an item to be claimable on round ${round}`);
    claimedBy[worker].push(claimed.id);
    // eslint-disable-next-line no-await-in-loop
    await queue.markProcessed(claimed.id, { processedBy: worker });
  }

  const allClaimed = [...claimedBy['worker-a'], ...claimedBy['worker-b']];
  assert.equal(allClaimed.length, ITEM_COUNT, 'every enqueued item should be claimed exactly once in total');
  assert.equal(new Set(allClaimed).size, ITEM_COUNT, 'no item should be claimed twice (SKIP LOCKED must prevent double-claim)');
  assert.deepEqual(new Set(allClaimed), new Set(enqueued), 'claimed items must be exactly the enqueued set');
  assert.ok(claimedBy['worker-a'].length > 0 && claimedBy['worker-b'].length > 0, 'both workers must claim at least one item');
  assert.equal(await queue.count(), 0, 'queue should be drained after all items are claimed and processed');
}

async function checkWorkerHeartbeat(sql) {
  const registry = new WorkerRegistry({ sql, project: PROJECT, tenantId: 'local' });
  await registry.register({ workerId: 'worker-a', capabilities: ['claim'] });
  await registry.register({ workerId: 'worker-b', capabilities: ['claim'] });

  const beatA = await registry.heartbeat('worker-a', { ttlSeconds: 60 });
  const beatB = await registry.heartbeat('worker-b', { ttlSeconds: 60 });
  assert.equal(beatA.renewed, true);
  assert.equal(beatB.renewed, true);

  const listed = await registry.list();
  const ids = listed.map((w) => w.workerId).sort();
  assert.deepEqual(ids, ['worker-a', 'worker-b'], 'both worker identities must be visible in the same registry listing at once');

  await registry.deregister('worker-a');
  await registry.deregister('worker-b');
}

const TEAM_CAPABILITY_CHECKS = {
  'postgres-queue': checkPostgresQueue,
  'worker-heartbeat': checkWorkerHeartbeat,
};

test('[LMCP-L6] team mode: every implemented capability has a passing acceptance check against real Postgres', async (t) => {
  if (!hasDatabaseUrl()) {
    t.skip('no DATABASE_URL/CONSTRUCT_DATABASE_URL set — team-mode acceptance requires a real Postgres (see dev/team-harness/README.md)');
    return;
  }

  const implemented = CAPABILITY_REGISTRY.team.filter((c) => c.status === 'implemented');
  const uncovered = implemented.filter((c) => typeof TEAM_CAPABILITY_CHECKS[c.id] !== 'function').map((c) => c.id);
  assert.deepEqual(
    uncovered,
    [],
    `team capabilities marked 'implemented' with no acceptance check (${uncovered.length}/${implemented.length}): ${uncovered.join(', ')}`,
  );

  const stillDeferred = CAPABILITY_REGISTRY.team
    .filter((c) => c.status !== 'implemented' && typeof TEAM_CAPABILITY_CHECKS[c.id] === 'function')
    .map((c) => c.id);
  assert.deepEqual(stillDeferred, [], `capability wired with a check but registry status has not been flipped to 'implemented': ${stillDeferred.join(', ')}`);

  const sql = createSqlClient(process.env);
  assert.ok(sql, 'DATABASE_URL/CONSTRUCT_DATABASE_URL is set but createSqlClient returned null — is the `postgres` package installed?');
  try {
    await applyMigrations(sql);
    for (const capability of implemented) {
      // eslint-disable-next-line no-await-in-loop
      await t.test(capability.id, () => TEAM_CAPABILITY_CHECKS[capability.id](sql));
    }
  } finally {
    await closeSqlClient(sql);
  }
});

test('[LMCP-L6] team mode: stub/not-implemented capabilities have not silently flipped', () => {
  const stubOrMissing = CAPABILITY_REGISTRY.team.filter((c) => c.status !== 'implemented');
  const flipped = stubOrMissing.filter((c) => c.status === 'implemented');
  assert.deepEqual(flipped, [], 'this branch is unreachable by construction — guards against a future edit making the filter meaningless');

  const expectedDeferred = ['shared-memory', 'docker-workers', 'central-telemetry', 'brokered-mcp'];
  const actualDeferred = stubOrMissing.map((c) => c.id).sort();
  assert.deepEqual(
    actualDeferred,
    [...expectedDeferred].sort(),
    'team-mode deferred capability set changed — update LMCP-L6 acceptance coverage (add a TEAM_CAPABILITY_CHECKS entry) if one flipped to implemented',
  );
});
