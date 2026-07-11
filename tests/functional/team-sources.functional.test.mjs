/**
 * tests/functional/team-sources.functional.test.mjs
 *
 * Team-scoped integration sources end to end: a unified-registry team declares
 * typed sources with filters, resolveTeamSources merges them, the filters thread
 * into embed source records tagged by team/target, the registry schema accepts a
 * team with sources, and provider_fetch (demandFetch) rejects a target outside
 * the team with a typed OUT_OF_SCOPE error rather than a silent wrong-source fetch.
 *
 * demandFetch writes observations through the machine-scoped state root
 * (ADR-0066), keyed by a hash of the tmp rootDir — so CX_HOME_OVERRIDE is
 * pinned for the whole file to keep that write off the real developer
 * machine's $HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';

import {
  resolveTeamSources,
  targetsToEmbedSourcesWithFilters,
} from '../../lib/config/source-targets.mjs';
import { validate } from '../../lib/registry/validator.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';
import { demandFetch } from '../../lib/embed/demand-fetch.mjs';
import { listObservations, getObservation } from '../../lib/observation-store.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

let homeOverride;
let prevHomeOverride;

before(() => {
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-team-sources-home-'));
  prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = homeOverride;
});

after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const REGISTRY = {
  teams: {
    'engineering-group': {
      sources: [
        { id: 'main-repo', provider: 'github', selector: { repo: 'anthropic/construct' }, filters: { refs: ['prs', 'issues'], limit: 15 } },
        { id: 'plat-jira', provider: 'jira', selector: { project: 'PLAT' }, filters: { jql: 'status != Done' } },
      ],
    },
  },
};

test('a team resolves its declared sources and threads filters into tagged embed records', () => {
  const targets = resolveTeamSources('engineering-group', { registry: REGISTRY, config: {}, env: {} });
  assert.equal(targets.length, 2);

  const sources = targetsToEmbedSourcesWithFilters(targets, { teamId: 'engineering-group' });
  const gh = sources.find((s) => s.provider === 'github');
  assert.deepEqual(gh.refs, ['prs', 'issues'], 'github refs come from the target filter');
  assert.equal(gh.limit, 15);
  assert.equal(gh.teamId, 'engineering-group');
  assert.equal(gh.targetId, 'main-repo', 'records stay retrievable by target scope');

  const jira = sources.find((s) => s.provider === 'jira');
  assert.equal(jira.jql, 'status != Done');
});

test('the unified-registry schema accepts a team with typed sources', () => {
  const base = loadRegistry({ skipValidation: true });
  const clone = JSON.parse(JSON.stringify(base));
  const firstTeam = Object.keys(clone.teams)[0];
  clone.teams[firstTeam].sources = [
    { id: 'main-repo', provider: 'github', selector: { repo: 'anthropic/construct' }, filters: { refs: ['prs'] } },
  ];
  const result = validate(clone);
  assert.equal(result.ok, true, `team-with-sources should validate: ${JSON.stringify(result.errors || [])}`);
});

test('provider_fetch rejects a target outside the team with a typed OUT_OF_SCOPE error', async () => {
  // product-group exists in the real registry but declares no sources, so any
  // requested target id is out of scope — must be a typed refusal, not a fetch.
  const result = await demandFetch({
    query: 'anything',
    teamId: 'product-group',
    targetIds: ['some-other-teams-repo'],
    rootDir: process.cwd(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OUT_OF_SCOPE');
  assert.equal(result.teamId, 'product-group');
});

test('demandFetch drives reads from the team\'s sources and tags observations team:/target:', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-fetch-'));
  // listObservations/getObservation below resolve the machine-scoped state
  // root (ADR-0066) via CX_HOME_OVERRIDE read in-process, not via the rootDir
  // argument — pin it or they write into the real developer machine's home.
  const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = tmp;
  try {
    // Injected mock provider returns one item per requested ref; injected
    // registry supplies the team — fully hermetic, no real credentials/CLI.
    const mockProvider = { read: async (ref) => [{ type: ref, id: `gh-${ref}`, title: `item ${ref}`, summary: `s-${ref}` }] };
    const providerRegistry = { get: (name) => (name === 'github' ? mockProvider : null) };
    const registry = { teams: { 'engineering-group': { sources: [
      { id: 'main-repo', provider: 'github', selector: { repo: 'anthropic/construct' }, filters: { refs: ['prs', 'issues'], limit: 5 } },
    ] } } };

    const result = await demandFetch({ teamId: 'engineering-group', rootDir: tmp, env: {}, registry, providerRegistry });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'team_fetched');
    assert.equal(result.teamId, 'engineering-group');
    assert.deepEqual(result.targetIds, ['main-repo']);
    assert.equal(result.items.length, 2, 'honors the refs filter (prs, issues) rather than the 6 default refs');
    assert.equal(result.written, 2);

    const stored = listObservations(tmp, { limit: 50 }).map((e) => getObservation(tmp, e.id)).filter(Boolean);
    assert.ok(stored.length >= 1, 'observations were persisted');
    const tagged = stored.find((o) => (o.tags || []).includes('team:engineering-group'));
    assert.ok(tagged, 'an observation is tagged team:engineering-group');
    assert.ok((tagged.tags || []).includes('target:main-repo'), 'and tagged target:main-repo');
  } finally {
    if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
    rmTmpDir(tmp);
  }
});
