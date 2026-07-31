/**
 * tests/functional/no-vector-fallback.functional.test.mjs — proves the
 * no-vector (keyword/BM25) retrieval adapter carries the observation memory
 * loop end to end when LanceDB is forced off (M5b),
 * and that switching adapters loses no durable data.
 *
 * Isolation: CONSTRUCT_HOME_OVERRIDE redirects the machine-scoped state root
 * so the keyword index and LanceDB directory both land under the
 * tmpdir sandbox, never the developer's real ~/.construct. Global env vars
 * (CONSTRUCT_HOME_OVERRIDE, CONSTRUCT_RETRIEVAL_ADAPTER, CONSTRUCT_EMBEDDING_MODEL)
 * are restored in t.after() per the functional-test isolation contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { addObservation, searchObservations, listObservations } from '../../lib/observation-store.mjs';
import { getStorageStatus, resetStorage, purgeExpiredData } from '../../lib/storage/admin.mjs';
import { KeywordRetrievalAdapter } from '../../lib/storage/adapters/keyword-adapter.mjs';
import { reindexObservations } from '../../scripts/reindex-retrieval-adapter.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function withEnv(overrides) {
  const prior = {};
  for (const key of Object.keys(overrides)) prior[key] = process.env[key];
  Object.assign(process.env, overrides);
  return { restore: () => {
    for (const key of Object.keys(overrides)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  } };
}

test('no-vector fallback: addObservation + searchObservations work end to end with CONSTRUCT_RETRIEVAL_ADAPTER=keyword', async (t) => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vector-fallback-'));
  const homeOverride = path.join(sandboxRoot, 'HOME');
  const project = path.join(sandboxRoot, 'project');
  fs.mkdirSync(homeOverride, { recursive: true });
  fs.mkdirSync(project, { recursive: true });

  const env = withEnv({
    CONSTRUCT_HOME_OVERRIDE: homeOverride,
    CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword',
    CONSTRUCT_EMBEDDING_MODEL: 'hashing',
  });
  t.after(() => { env.restore(); rmTmpDir(sandboxRoot); });

  const record = await addObservation(project, {
    role: 'engineer',
    category: 'pattern',
    summary: 'Authentication uses JWT tokens with refresh flow',
    content: 'The auth module uses JWT. Refresh tokens stored in httpOnly cookies.',
    tags: ['auth', 'jwt'],
    project: 'myapp',
  });
  assert.ok(record.id.startsWith('obs-'), 'the domain-model JSON record is written regardless of adapter');

  // Durable artifact #1: the observation's own JSON file (D4s domain model,
  // unaffected by which retrieval adapter is active).
  const recordPath = path.join(project, '.construct', 'observations', `${record.id}.json`);
  assert.ok(fs.existsSync(recordPath), 'observation JSON record persists independent of the retrieval adapter');

  // Durable artifact #2: the keyword adapter's own derived index, proving the
  // no-vector path actually wrote something rather than silently no-op'ing.
  const projectsRoot = path.join(homeOverride, '.construct', 'projects');
  assert.ok(fs.existsSync(projectsRoot), 'a machine-scoped project state dir was created');
  const [projectKey] = fs.readdirSync(projectsRoot);
  const keywordIndexFile = path.join(projectsRoot, projectKey, 'keyword-index', 'observations.json');
  assert.ok(fs.existsSync(keywordIndexFile), 'keyword adapter writes its own observations.json index');
  assert.equal(fs.existsSync(path.join(projectsRoot, projectKey, 'lancedb')), false, 'no LanceDB directory is created while the keyword adapter is forced');

  const results = await searchObservations(project, 'authentication JWT tokens', { project: 'myapp' });
  assert.ok(results.length >= 1, 'BM25 finds the seeded observation with no vector database present');
  assert.match(results[0].summary, /JWT/);

  const filtered = await searchObservations(project, 'authentication', { project: 'myapp', role: 'architect' });
  assert.equal(filtered.length, 0, 'role filter still applies under the keyword adapter');
});

test('no-vector fallback: getStorageStatus/purgeExpiredData/resetStorage operate on the keyword index', async (t) => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vector-admin-'));
  const homeOverride = path.join(sandboxRoot, 'HOME');
  const project = path.join(sandboxRoot, 'project');
  fs.mkdirSync(homeOverride, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(project, '.construct'), { recursive: true });

  const env = { CONSTRUCT_HOME_OVERRIDE: homeOverride, CONSTRUCT_RETRIEVAL_ADAPTER: 'keyword', CONSTRUCT_EMBEDDING_MODEL: 'hashing' };
  const envRestore = withEnv(env);
  t.after(() => { envRestore.restore(); rmTmpDir(sandboxRoot); });

  const before = await getStorageStatus(project, { env: { ...process.env, ...env } });
  assert.equal(before.backend, 'keyword');
  assert.equal(before.status, 'degraded', 'no keyword index yet, but .construct/ exists');

  // addObservation always stamps `createdAt: now` (lib/observation-store.mjs
  // never accepts a caller-supplied createdAt), so a genuinely stale row for
  // the eviction assertion below is written directly through the adapter —
  // mirroring tests/observation-retention.test.mjs's approach for the
  // LanceDB path.
  const adapter = new KeywordRetrievalAdapter({ env: { ...process.env, ...env }, rootDir: project });
  await adapter.storeObservation({
    id: 'obs-stale-1',
    project: 'p',
    role: 'engineer',
    category: 'insight',
    summary: 'stale observation',
    content: 'body',
    createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const after = await getStorageStatus(project, { env: { ...process.env, ...env } });
  assert.equal(after.status, 'healthy');

  const purge = await purgeExpiredData(project, { env: { ...process.env, ...env }, maxAgeDays: 30, maxRows: 5000 });
  assert.equal(purge.status, 'ok');
  assert.equal(purge.evictedCount, 1, 'the 200-day-old observation is evicted under the keyword adapter too');

  await resetStorage(project, { env: { ...process.env, ...env } });
  const afterReset = await getStorageStatus(project, { env: { ...process.env, ...env } });
  assert.equal(afterReset.status, 'degraded', 'resetStorage removes the keyword index directory');
});

test('reindex-retrieval-adapter: rebuilds the keyword index from durable observation records with no data loss', async (t) => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vector-reindex-'));
  const homeOverride = path.join(sandboxRoot, 'HOME');
  const project = path.join(sandboxRoot, 'project');
  fs.mkdirSync(homeOverride, { recursive: true });
  fs.mkdirSync(project, { recursive: true });

  const env = withEnv({ CONSTRUCT_HOME_OVERRIDE: homeOverride, CONSTRUCT_EMBEDDING_MODEL: 'hashing' });
  t.after(() => { env.restore(); rmTmpDir(sandboxRoot); });

  // Seed two observations while the default/auto adapter (LanceDB, reachable
  // in this dev environment) is active — the keyword index knows nothing
  // about them yet.
  delete process.env.CONSTRUCT_RETRIEVAL_ADAPTER;
  await addObservation(project, { role: 'engineer', summary: 'first observation about retries', content: 'retry backoff details', project: 'p' });
  await addObservation(project, { role: 'engineer', summary: 'second observation about caching', content: 'cache invalidation details', project: 'p' });
  const domainRecords = listObservations(project, { limit: 100 });
  assert.equal(domainRecords.length, 2, 'both observations land in the durable domain-model index regardless of adapter');

  // Force keyword mode: searches find nothing until the index is rebuilt.
  process.env.CONSTRUCT_RETRIEVAL_ADAPTER = 'keyword';
  const beforeReindex = await searchObservations(project, 'retries caching', { project: 'p' });
  assert.equal(beforeReindex.length, 0, 'the keyword adapter has no data before re-indexing');

  const dryRun = await reindexObservations(project, { env: process.env, dryRun: true });
  assert.equal(dryRun.total, 2);
  assert.equal(dryRun.reindexed, 2);
  const stillEmptyAfterDryRun = await searchObservations(project, 'retries', { project: 'p' });
  assert.equal(stillEmptyAfterDryRun.length, 0, 'dry-run performs no writes');

  const realRun = await reindexObservations(project, { env: process.env, dryRun: false });
  assert.equal(realRun.reindexed, 2);

  const afterReindex = await searchObservations(project, 'retries caching', { project: 'p' });
  assert.equal(afterReindex.length, 2, 'both observations are searchable via the keyword adapter after re-indexing — no data loss');

  const idempotentRun = await reindexObservations(project, { env: process.env, dryRun: false });
  assert.equal(idempotentRun.reindexed, 0, 'a second reindex is a no-op — every fingerprint already matches');
  assert.equal(idempotentRun.upToDate, 2);
});
