/**
 * tests/worker-runtime.test.mjs — worker identity and heartbeat registry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkerRegistry } from '../lib/orchestration/worker-runtime.mjs';

function fakeSql() {
  const state = { applied: new Set(), workers: new Map(), unsafe: [] };
  function key(project, tenant, workerId) {
    return `${project}\0${tenant}\0${workerId}`;
  }
  function query(strings, ...values) {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (/SELECT id, applied_at FROM construct_schema_migrations/i.test(text)) {
      return Promise.resolve([...state.applied].sort().map((id) => ({ id, applied_at: new Date(0).toISOString() })));
    }
    if (/INSERT INTO construct_schema_migrations/i.test(text)) {
      state.applied.add(values[0]);
      return Promise.resolve([]);
    }
    if (/INSERT INTO construct_workers/i.test(text)) {
      const [project, tenant, workerId, host, pid, capabilities, ttl, metadata] = values;
      state.workers.set(key(project, tenant, workerId), {
        project,
        tenant_id: tenant,
        worker_id: workerId,
        host,
        pid,
        capabilities,
        registered_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        lease_ttl_seconds: ttl,
        status: 'active',
        metadata,
      });
      return Promise.resolve([]);
    }
    if (/UPDATE construct_workers\s+SET heartbeat_at/i.test(text)) {
      const [ttl, project, tenant, workerId] = values;
      const row = state.workers.get(key(project, tenant, workerId));
      if (!row) return Promise.resolve([]);
      row.heartbeat_at = new Date().toISOString();
      row.lease_ttl_seconds = ttl;
      row.status = 'active';
      return Promise.resolve([{ worker_id: workerId, heartbeat_at: row.heartbeat_at, lease_ttl_seconds: ttl }]);
    }
    if (/UPDATE construct_workers\s+SET status = 'stopped'/i.test(text)) {
      const [project, tenant, workerId] = values;
      const row = state.workers.get(key(project, tenant, workerId));
      if (!row) return Promise.resolve([]);
      row.status = 'stopped';
      return Promise.resolve([{ worker_id: workerId }]);
    }
    if (/FROM construct_workers/i.test(text)) {
      const [project, tenant] = values;
      const now = Date.now();
      return Promise.resolve([...state.workers.values()]
        .filter((row) => row.project === project && row.tenant_id === tenant)
        .map((row) => ({
          ...row,
          stale: Date.parse(row.heartbeat_at) + row.lease_ttl_seconds * 1000 < now,
        })));
    }
    return Promise.resolve([]);
  }
  query.unsafe = async (body) => { state.unsafe.push(body); };
  query.begin = async (fn) => fn(query);
  query.json = (value) => value;
  query.state = state;
  return query;
}

test('WorkerRegistry registers, heartbeats, lists, and deregisters workers', async () => {
  const sql = fakeSql();
  const registry = new WorkerRegistry({ sql, project: 'p', tenantId: 'local' });

  const registered = await registry.register({
    workerId: 'worker-a',
    host: 'host-a',
    pid: 123,
    capabilities: ['queue', 'queue', 'orchestration'],
    ttlSeconds: 30,
  });
  assert.equal(registered.workerId, 'worker-a');
  assert.deepEqual(registered.capabilities, ['orchestration', 'queue']);

  const beat = await registry.heartbeat('worker-a', { ttlSeconds: 45 });
  assert.equal(beat.renewed, true);
  assert.equal(beat.ttlSeconds, 45);

  const workers = await registry.list();
  assert.equal(workers.length, 1);
  assert.equal(workers[0].workerId, 'worker-a');
  assert.equal(workers[0].status, 'active');

  const stopped = await registry.deregister('worker-a');
  assert.equal(stopped.stopped, true);
  assert.equal((await registry.list())[0].status, 'stopped');
});

test('WorkerRegistry marks expired heartbeat rows stale', async () => {
  const sql = fakeSql();
  const registry = new WorkerRegistry({ sql, project: 'p', tenantId: 'local' });
  await registry.register({ workerId: 'worker-stale', ttlSeconds: 1 });
  const row = [...sql.state.workers.values()][0];
  row.heartbeat_at = new Date(Date.now() - 10_000).toISOString();

  const workers = await registry.list();
  assert.equal(workers[0].stale, true);
  assert.equal(workers[0].status, 'stale');
});
