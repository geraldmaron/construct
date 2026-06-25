/**
 * tests/functional/team-sources.functional.test.mjs
 *
 * Team-scoped integration sources end to end: a unified-registry team declares
 * typed sources with filters, resolveTeamSources merges them, the filters thread
 * into embed source records tagged by team/target, the registry schema accepts a
 * team with sources, and provider_fetch (demandFetch) rejects a target outside
 * the team with a typed OUT_OF_SCOPE error rather than a silent wrong-source fetch.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveTeamSources,
  targetsToEmbedSourcesWithFilters,
} from '../../lib/config/source-targets.mjs';
import { validate } from '../../lib/registry/validator.mjs';
import { loadRegistry } from '../../lib/registry/loader.mjs';
import { demandFetch } from '../../lib/embed/demand-fetch.mjs';

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
