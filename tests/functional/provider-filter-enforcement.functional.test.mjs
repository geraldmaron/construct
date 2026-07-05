/**
 * tests/functional/provider-filter-enforcement.functional.test.mjs — LMCP-B11.
 *
 * Proves the ADR-0060 filter block is enforced on the real poll path, not
 * just validated in isolation:
 *   1. A fake provider returning items both inside and outside a configured
 *      filter produces zero observations for the out-of-filter items after
 *      a real `EmbedDaemon` snapshot cycle and real `distillSnapshotItems`
 *      call, asserted against the on-disk observation store.
 *   2. The per-poll filter-audit JSONL records {provider, instance,
 *      filterHash, matched, dropped} for the applied filter.
 *   3. An unknown filter key fails the source: the poll produces a visible
 *      config error and the section's items are dropped rather than
 *      silently ingested.
 *   4. Jira JQL pushdown (buildJqlFromFilter) and the plane-side predicate
 *      (matchesFilter) agree on the same fixture — pushdown is an
 *      optimization, plane-side is the enforcement.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EmbedDaemon, enforceSectionFilters, distillSnapshotItems } from '../../lib/embed/daemon.mjs';
import { ProviderRegistry } from '../../lib/embed/providers/registry.mjs';
import { normalize } from '../../lib/embed/config.mjs';
import { demandFetch } from '../../lib/embed/demand-fetch.mjs';
import { listObservations, getObservation } from '../../lib/observation-store.mjs';
import { filterAuditPath, readFilterAudit } from '../../lib/providers/filter-audit.mjs';
import { matchesFilter } from '../../lib/providers/contract.mjs';
import { buildJqlFromFilter } from '../../lib/embed/providers/jira.mjs';

function makeRootDir(t, label) {
  const rootDir = mkdtempSync(join(tmpdir(), `pfe-${label}-`));
  mkdirSync(join(rootDir, '.cx'), { recursive: true });
  writeFileSync(join(rootDir, '.cx', 'context.md'), '# ctx\n');
  t.after(() => { try { rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} });
  return rootDir;
}

const FIXTURE_ITEMS = [
  { type: 'issue', key: 'ABC-1', id: 'ABC-1', url: 'https://x/ABC-1', summary: 'In scope', project: 'ABC', status: 'In Progress', statusCategory: 'In Progress', assignee: 'alice', priority: 'High', labels: ['security'], updatedAt: new Date().toISOString() },
  { type: 'issue', key: 'ABC-2', id: 'ABC-2', url: 'https://x/ABC-2', summary: 'Wrong project', project: 'XYZ', status: 'In Progress', statusCategory: 'In Progress', assignee: 'alice', priority: 'High', labels: ['security'], updatedAt: new Date().toISOString() },
  { type: 'issue', key: 'ABC-3', id: 'ABC-3', url: 'https://x/ABC-3', summary: 'Wrong assignee', project: 'ABC', status: 'In Progress', statusCategory: 'In Progress', assignee: 'bob', priority: 'High', labels: ['security'], updatedAt: new Date().toISOString() },
  { type: 'issue', key: 'ABC-4', id: 'ABC-4', url: 'https://x/ABC-4', summary: 'Wrong status', project: 'ABC', status: 'Done', statusCategory: 'Done', assignee: 'alice', priority: 'High', labels: ['security'], updatedAt: new Date().toISOString() },
];

const FILTER_BLOCK = {
  scope: { projects: ['ABC'] },
  predicates: { assignee: ['alice'], statusCategory: ['in-progress'] },
};

function makeFakeProvider(items) {
  return {
    async read() { return items; },
    async health() { return { ok: true }; },
  };
}

test('enforceSectionFilters drops out-of-filter items before distillation reaches zero observations for them', async (t) => {
  const rootDir = makeRootDir(t, 'core');

  const snapshot = {
    sections: [{ provider: 'jira', refs: ['issues'], items: [...FIXTURE_ITEMS] }],
    errors: [],
  };
  const sources = [{ provider: 'jira', instance: 'primary', filter: FILTER_BLOCK }];

  enforceSectionFilters(rootDir, snapshot, sources);

  assert.equal(snapshot.sections[0].items.length, 1, 'only the in-scope item survives plane-side filtering');
  assert.equal(snapshot.sections[0].items[0].key, 'ABC-1');

  const written = await distillSnapshotItems(rootDir, snapshot.sections);
  assert.equal(written, 1, 'exactly one observation written for the one admitted item');

  const observations = listObservations(rootDir, { limit: 100 });
  const keys = observations.map((o) => o.summary);
  assert.ok(keys.some((s) => s?.includes('ABC-1')), 'admitted item is present in the observation store');
  assert.ok(!keys.some((s) => s?.includes('ABC-2')), 'wrong-project item never became an observation');
  assert.ok(!keys.some((s) => s?.includes('ABC-3')), 'wrong-assignee item never became an observation');
  assert.ok(!keys.some((s) => s?.includes('ABC-4')), 'wrong-status item never became an observation');
});

test('filter-audit JSONL records {provider, instance, filterHash, matched, dropped} per poll', async (t) => {
  const rootDir = makeRootDir(t, 'audit');

  const snapshot = {
    sections: [{ provider: 'jira', refs: ['issues'], items: [...FIXTURE_ITEMS] }],
    errors: [],
  };
  const sources = [{ provider: 'jira', instance: 'primary', filter: FILTER_BLOCK }];

  enforceSectionFilters(rootDir, snapshot, sources);

  assert.ok(existsSync(filterAuditPath(rootDir)), 'filter-audit.jsonl was written');
  const lines = readFilterAudit(rootDir);
  assert.equal(lines.length, 1);
  const [record] = lines;
  assert.equal(record.provider, 'jira');
  assert.equal(record.instance, 'primary');
  assert.equal(typeof record.filterHash, 'string');
  assert.equal(record.filterHash.length, 16);
  assert.equal(record.matched, 1);
  assert.equal(record.dropped, 3);
  assert.equal(record.filterApplied.fetched, 4);
  assert.equal(record.filterApplied.admitted, 1);
});

test('unknown filter key fails the source: visible config error, items dropped, nothing distilled', async (t) => {
  const rootDir = makeRootDir(t, 'unknown-key');

  const snapshot = {
    sections: [{ provider: 'jira', refs: ['issues'], items: [...FIXTURE_ITEMS] }],
    errors: [],
  };
  const sources = [{ provider: 'jira', instance: 'primary', filter: { scope: { bogusKey: ['ABC'] } } }];

  enforceSectionFilters(rootDir, snapshot, sources);

  assert.equal(snapshot.sections[0].items.length, 0, 'invalid filter fails closed: zero items survive');
  assert.equal(snapshot.errors.length, 1);
  assert.match(snapshot.errors[0].error, /filter config/);
  assert.match(snapshot.errors[0].error, /bogusKey/);

  const written = await distillSnapshotItems(rootDir, snapshot.sections);
  assert.equal(written, 0, 'nothing is silently ingested when the filter config is invalid');

  const lines = readFilterAudit(rootDir);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].matched, 0);
  assert.equal(lines[0].dropped, 4);
});

test('unknown predicate key throws from validateFilterConfig with the offending key named', async () => {
  const { validateFilterConfig } = await import('../../lib/providers/contract.mjs');
  assert.throws(
    () => validateFilterConfig('jira', { predicates: { bogusPredicate: ['x'] } }),
    /unknown predicate key "bogusPredicate"/,
  );
});

test('nativeQuery passthrough on a provider that does not support it fails closed', async () => {
  const { validateFilterConfig } = await import('../../lib/providers/contract.mjs');
  assert.throws(
    () => validateFilterConfig('slack', { nativeQuery: 'anything' }),
    /nativeQuery passthrough is not supported/,
  );
});

test('Jira JQL pushdown and the plane-side predicate agree on the same fixture', async () => {
  const jql = buildJqlFromFilter({}, FILTER_BLOCK);

  // The compiled JQL must scope to the same project/assignee/status
  // dimensions the plane-side predicate enforces — proving pushdown and
  // plane-side fallback express the identical filter, not two dialects
  // that drift apart.
  assert.match(jql, /project in \("ABC"\)/);
  assert.match(jql, /assignee in \("alice"\)/);
  assert.match(jql, /statusCategory in \("In Progress"\)/);

  const admittedByPlaneSide = FIXTURE_ITEMS.filter((item) => matchesFilter(item, FILTER_BLOCK));
  assert.deepEqual(admittedByPlaneSide.map((i) => i.key), ['ABC-1']);

  // Simulate what a real Jira server would return for the compiled JQL:
  // only items matching all three JQL clauses. Confirms pushdown wouldn't
  // have returned ABC-2/ABC-3/ABC-4 either, so plane-side is a backstop,
  // not the sole enforcement point.
  const wouldMatchJql = (item) => item.project === 'ABC' && item.assignee === 'alice' && item.statusCategory === 'In Progress';
  const admittedByPushdownSimulation = FIXTURE_ITEMS.filter(wouldMatchJql);
  assert.deepEqual(
    admittedByPushdownSimulation.map((i) => i.key),
    admittedByPlaneSide.map((i) => i.key),
    'pushdown-equivalent JQL selection matches the plane-side predicate result exactly',
  );
});

test('end-to-end: real EmbedDaemon snapshot cycle with a fake provider enforces the filter', async (t) => {
  const rootDir = makeRootDir(t, 'daemon');

  const registry = new ProviderRegistry();
  registry.register('fake-jira', makeFakeProvider(FIXTURE_ITEMS));

  const config = normalize({
    sources: [{ provider: 'fake-jira', refs: ['issues'], filter: FILTER_BLOCK, instance: 'primary' }],
    outputs: [],
    snapshot: { intervalMs: 3_600_000, maxItems: 100 },
  });

  const daemon = new EmbedDaemon({ config, registry, rootDir, workspaceDir: rootDir, env: {} });
  await daemon.start();
  t.after(() => daemon.stop());

  // The snapshot job runs immediately but asynchronously (fire-and-forget
  // inside the scheduler); wait on the durable artifact it produces rather
  // than a fixed sleep.
  const deadline = Date.now() + 5000;
  while (!daemon.lastSnapshot() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }

  const snapshot = daemon.lastSnapshot();
  assert.ok(snapshot, 'daemon produced a snapshot within the deadline');
  assert.equal(snapshot.sections[0].items.length, 1, 'daemon poll loop filtered sections before returning');

  // Distillation into the observation store is a separate async step after the
  // snapshot object is set; poll for the admitted item rather than racing it.
  const obsDeadline = Date.now() + 5000;
  let summaries = [];
  while (Date.now() < obsDeadline) {
    summaries = listObservations(rootDir, { limit: 100 }).map((o) => o.summary).filter(Boolean);
    if (summaries.some((s) => s.includes('ABC-1'))) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(summaries.some((s) => s.includes('ABC-1')), 'in-filter item reached the observation store via the real daemon poll loop');
  assert.ok(!summaries.some((s) => s.includes('ABC-2') || s.includes('ABC-3') || s.includes('ABC-4')), 'out-of-filter items never became observations via the real daemon poll loop');

  assert.ok(existsSync(filterAuditPath(rootDir)), 'daemon poll loop wrote the filter audit line');
  const auditLines = readFilterAudit(rootDir);
  assert.ok(auditLines.some((l) => l.provider === 'fake-jira' && l.matched === 1 && l.dropped === 3));
});

test('construct-737t: demandFetch (team-scoped) drops out-of-scope items via the same embed.yaml filter enforceSectionFilters uses on the poll path', async (t) => {
  const rootDir = makeRootDir(t, 'demand-fetch-filter');
  const xdgConfigHome = join(rootDir, 'xdg-config');
  const embedConfigDir = join(xdgConfigHome, 'construct');
  mkdirSync(embedConfigDir, { recursive: true });

  // Source declares a broader repo list ([org/a, org/b]) than its
  // filter.scope narrows to ([org/a]) — the exact gap construct-737t
  // describes. enforceSectionFilters already drops org/b on the poll path via
  // an identical embed.yaml block; demandFetchTeam's read path is under test.
  writeFileSync(join(embedConfigDir, 'embed.yaml'), [
    'sources:',
    '  - provider: github',
    '    repos: [org/a, org/b]',
    '    refs: [issues]',
    '    filter:',
    '      scope:',
    '        repos: [org/a]',
    'outputs: []',
    '',
  ].join('\n'));

  const env = { XDG_CONFIG_HOME: xdgConfigHome };

  const mockProvider = {
    read: async (ref, opts) => {
      const repo = opts?.repos?.[0];
      if (ref !== 'issues' || !repo) return [];
      return [{ type: 'issue', id: `${repo}-1`, key: `${repo}-1`, title: `Item in ${repo}`, summary: `Item in ${repo}`, repo }];
    },
  };
  const providerRegistry = { get: (name) => (name === 'github' ? mockProvider : null) };
  const registry = {
    teams: {
      'eng-team': {
        sources: [
          { id: 'repo-a', provider: 'github', selector: { repo: 'org/a' }, filters: { refs: ['issues'] } },
          { id: 'repo-b', provider: 'github', selector: { repo: 'org/b' }, filters: { refs: ['issues'] } },
        ],
      },
    },
  };

  const result = await demandFetch({ teamId: 'eng-team', rootDir, env, registry, providerRegistry });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'team_fetched');
  // Before construct-737t: both org/a and org/b items would reach
  // addObservation() — demandFetchTeam called provider.read() directly and
  // never applied filter.scope. After: only the item inside filter.scope
  // (org/a) survives, matching what enforceSectionFilters already guarantees
  // on the daemon poll path for the identical filter block.
  assert.deepEqual(result.items.map((i) => i.repo), ['org/a']);
  assert.equal(result.written, 1);

  const stored = listObservations(rootDir, { limit: 50 }).map((e) => getObservation(rootDir, e.id)).filter(Boolean);
  const summaries = stored.map((o) => o.summary).filter(Boolean);
  assert.ok(summaries.some((s) => s.includes('org/a')), 'in-scope repo item reached the observation store');
  assert.ok(!summaries.some((s) => s.includes('org/b')), 'out-of-scope repo item never became an observation, matching the poll path');
});

test('construct-737t: a governing filter never swallows a provider error sentinel in demandFetchTeam', async (t) => {
  const rootDir = makeRootDir(t, 'demand-fetch-filter-errors');
  const xdgConfigHome = join(rootDir, 'xdg-config');
  const embedConfigDir = join(xdgConfigHome, 'construct');
  mkdirSync(embedConfigDir, { recursive: true });

  writeFileSync(join(embedConfigDir, 'embed.yaml'), [
    'sources:',
    '  - provider: github',
    '    repos: [org/a]',
    '    refs: [issues]',
    '    filter:',
    '      scope:',
    '        repos: [org/a]',
    'outputs: []',
    '',
  ].join('\n'));

  const env = { XDG_CONFIG_HOME: xdgConfigHome };

  const mockProvider = {
    read: async (ref, opts) => {
      const repo = opts?.repos?.[0];
      return [
        { type: 'error', message: `rate limited fetching ${repo}` },
        { type: 'issue', id: `${repo}-1`, key: `${repo}-1`, title: `Item in ${repo}`, summary: `Item in ${repo}`, repo },
      ];
    },
  };
  const providerRegistry = { get: (name) => (name === 'github' ? mockProvider : null) };
  const registry = {
    teams: {
      'eng-team': {
        sources: [
          { id: 'repo-a', provider: 'github', selector: { repo: 'org/a' }, filters: { refs: ['issues'] } },
        ],
      },
    },
  };

  const result = await demandFetch({ teamId: 'eng-team', rootDir, env, registry, providerRegistry });

  // matchesFilter has no scope field to check on an error sentinel; it must
  // never be judged by filter.scope in the first place, or a real provider
  // error would vanish behind an unrelated filter block.
  assert.ok(result.errors?.some((e) => e.message?.includes('rate limited')), 'error sentinel surfaced despite a governing filter being configured');
  assert.deepEqual(result.items.map((i) => i.repo), ['org/a'], 'the in-scope data item still passed through the filter');
});
