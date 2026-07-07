/**
 * tests/functional/shared-state.functional.test.mjs — LMCP-G10.
 *
 * Two guarantees: a trace event saved through one store instance is visible
 * through a second, independent store instance backed by the same shared
 * substrate (the "worker A writes, machine B reads" run-visibility
 * contract); and the shared-memory boundary refuses anything that is not an
 * explicit, provenanced opt-in — a private/session-scratch observation never
 * reaches the shared table, by construction rather than by filtering after
 * the fact.
 *
 * No live Postgres is available in this environment, so a minimal in-memory
 * fake `sql` tagged-template client backs both stores, implementing exactly
 * the query shapes trace-store.mjs/shared-memory.mjs emit. Injecting the same
 * fake into two independently-resolved store instances is what makes them
 * genuinely share one underlying table, the same way two machines pointed at
 * one DATABASE_URL would.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTraceStore } from '../../lib/orchestration/trace-store.mjs';
import { resolveSharedMemoryStore } from '../../lib/storage/shared-memory.mjs';

function sharedFakeSql() {
  const traceRows = [];
  const memoryRows = [];

  function query(strings, ...values) {
    const text = Array.isArray(strings) ? strings.join('?') : String(strings);

    if (/construct_schema_migrations/i.test(text)) return Promise.resolve([]);

    if (/INSERT INTO construct_trace_events/i.test(text)) {
      const [project, tenantId, traceId, spanId, parentSpanId, eventType, role, taskId, metadata, createdAt] = values;
      const exists = traceRows.some((r) => r.project === project && r.tenant_id === tenantId && r.trace_id === traceId && r.span_id === spanId);
      if (!exists) {
        traceRows.push({ project, tenant_id: tenantId, trace_id: traceId, span_id: spanId, parent_span_id: parentSpanId, event_type: eventType, role, task_id: taskId, metadata, created_at: createdAt });
      }
      return Promise.resolve([]);
    }

    if (/SELECT .* FROM construct_trace_events/is.test(text)) {
      const hasTraceIdFilter = /trace_id = /i.test(text);
      if (hasTraceIdFilter) {
        const [project, tenantId, traceId] = values;
        return Promise.resolve(traceRows.filter((r) => r.project === project && r.tenant_id === tenantId && r.trace_id === traceId));
      }
      const [project, tenantId] = values;
      return Promise.resolve(traceRows.filter((r) => r.project === project && r.tenant_id === tenantId));
    }

    if (/INSERT INTO construct_shared_memory/i.test(text)) {
      const [id, project, tenantId, category, summary, content, tags, provenance, createdAt] = values;
      const row = { id, project, tenant_id: tenantId, category, summary, content, tags, provenance, created_at: createdAt };
      const idx = memoryRows.findIndex((r) => r.project === project && r.tenant_id === tenantId && r.id === id);
      if (idx === -1) memoryRows.push(row); else memoryRows[idx] = row;
      return Promise.resolve([]);
    }

    if (/SELECT .* FROM construct_shared_memory/is.test(text)) {
      const [project, tenantId] = values;
      return Promise.resolve(memoryRows.filter((r) => r.project === project && r.tenant_id === tenantId));
    }

    return Promise.resolve([]);
  }
  query.unsafe = async () => {};
  query.begin = async (fn) => fn(query);
  query.json = (value) => value;
  return query;
}

test('a trace event saved through one store instance is visible via a second, independent store instance sharing the same substrate', async () => {
  const sql = sharedFakeSql();
  const workerA = resolveTraceStore({ env: {}, sql });
  const workerB = resolveTraceStore({ env: {}, sql });
  assert.equal(workerA.kind, 'postgres');

  const event = { traceId: 'trace-shared-1', spanId: 'span-1', eventType: 'lifecycle.completed', metadata: { runId: 'run-1', status: 'completed' }, createdAt: new Date().toISOString() };
  await workerA.saveTraceEvent(event, { project: 'acme', tenantId: 'local' });

  const seenByB = await workerB.listTeamTraces({ project: 'acme', tenantId: 'local', traceId: 'trace-shared-1' });
  assert.equal(seenByB.length, 1);
  assert.equal(seenByB[0].eventType, 'lifecycle.completed');
  assert.equal(seenByB[0].metadata.runId, 'run-1');

  const otherProject = await workerB.listTeamTraces({ project: 'other-project', tenantId: 'local', traceId: 'trace-shared-1' });
  assert.equal(otherProject.length, 0, 'traces must be project-scoped');
});

test('solo mode with no injected sql resolves to a none-store that never fabricates team visibility', async () => {
  const store = resolveTraceStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'solo' } });
  assert.equal(store.kind, 'none');
  const result = await store.saveTraceEvent({ traceId: 't', spanId: 's', eventType: 'lifecycle.completed' }, { project: 'p' });
  assert.equal(result.ok, false);
  assert.deepEqual(await store.listTeamTraces({ project: 'p' }), []);
});

test('a private observation (no visibility field) is refused from the shared-memory store', async () => {
  const sql = sharedFakeSql();
  const store = resolveSharedMemoryStore({ env: {}, sql });

  const privateObservation = { id: 'obs-1', category: 'insight', summary: 'private scratch note', provenance: { role: 'cx-engineer' } };
  const result = await store.writeSharedMemory(privateObservation, { project: 'acme' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /visibility/);

  const listed = await store.listSharedMemory({ project: 'acme' });
  assert.equal(listed.length, 0, 'a refused write must never appear in the shared store');
});

test('a sessionScratch-marked observation is refused even with visibility set to shared-project', async () => {
  const sql = sharedFakeSql();
  const store = resolveSharedMemoryStore({ env: {}, sql });

  const scratch = { id: 'obs-2', category: 'insight', visibility: 'shared-project', provenance: { role: 'cx-engineer' }, sessionScratch: true };
  const result = await store.writeSharedMemory(scratch, { project: 'acme' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /sessionScratch/);
});

test('an explicit shared-project observation with provenance is written and readable across store instances', async () => {
  const sql = sharedFakeSql();
  const writerStore = resolveSharedMemoryStore({ env: {}, sql });
  const readerStore = resolveSharedMemoryStore({ env: {}, sql });

  const shared = {
    id: 'obs-3', category: 'decision', summary: 'Adopted postgres for team mode',
    visibility: 'shared-project', provenance: { role: 'cx-architect', runId: 'run-9' },
  };
  const result = await writerStore.writeSharedMemory(shared, { project: 'acme', tenantId: 'local' });
  assert.equal(result.ok, true);

  const listed = await readerStore.listSharedMemory({ project: 'acme', tenantId: 'local' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'obs-3');
  assert.equal(listed[0].provenance.role, 'cx-architect');
});

test('solo mode with no injected sql resolves the shared-memory store to a none-store', async () => {
  const store = resolveSharedMemoryStore({ env: { CONSTRUCT_DEPLOYMENT_MODE: 'solo' } });
  assert.equal(store.kind, 'none');
  const result = await store.writeSharedMemory({ id: 'x', category: 'insight', visibility: 'shared-project', provenance: { role: 'r' } }, { project: 'p' });
  assert.equal(result.ok, false);
});
