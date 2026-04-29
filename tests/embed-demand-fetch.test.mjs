/**
 * tests/embed-demand-fetch.test.mjs — demand-fetch unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnownSources, matchSourceFromQuery } from '../lib/embed/demand-fetch.mjs';

const ENV_GITHUB = {
  GITHUB_REPOS: 'hashicorp/project-iverson,hashicorp/cloud-reliability,hashicorp/team-delivery-intelligence',
  GITHUB_TOKEN: 'ghp_fake',
};

const ENV_JIRA = {
  JIRA_BASE_URL: 'https://hashicorp.atlassian.net',
  JIRA_PROJECTS: 'PLAT,INF',
};

const ENV_LINEAR = {
  LINEAR_API_KEY: 'lin_fake',
  LINEAR_TEAMS: 'platform,infra',
};

describe('resolveKnownSources', () => {
  it('expands GitHub repos into multiple id variants', () => {
    const sources = resolveKnownSources(ENV_GITHUB);
    const ids = sources.map(s => s.id);
    // full repo
    assert.ok(ids.includes('hashicorp/project-iverson'));
    // short name
    assert.ok(ids.includes('project-iverson'));
    // normalised (no dashes)
    assert.ok(ids.includes('projectiverson'));
    // last word
    assert.ok(ids.includes('iverson'));
    // all point to the same ref
    const iverson = sources.find(s => s.id === 'iverson');
    assert.equal(iverson.ref, 'hashicorp/project-iverson');
    assert.equal(iverson.provider, 'github');
  });

  it('includes all three repos', () => {
    const sources = resolveKnownSources(ENV_GITHUB);
    const refs = [...new Set(sources.map(s => s.ref))];
    assert.ok(refs.includes('hashicorp/project-iverson'));
    assert.ok(refs.includes('hashicorp/cloud-reliability'));
    assert.ok(refs.includes('hashicorp/team-delivery-intelligence'));
  });

  it('expands Jira projects', () => {
    const sources = resolveKnownSources(ENV_JIRA);
    const ids = sources.map(s => s.id);
    assert.ok(ids.includes('plat'));
    assert.ok(ids.includes('inf'));
    assert.ok(ids.includes('jira'));
  });

  it('expands Linear teams', () => {
    const sources = resolveKnownSources(ENV_LINEAR);
    const ids = sources.map(s => s.id);
    assert.ok(ids.includes('platform'));
    assert.ok(ids.includes('infra'));
    assert.ok(ids.includes('linear'));
  });

  it('returns empty array when no sources configured', () => {
    const sources = resolveKnownSources({});
    assert.equal(sources.length, 0);
  });
});

describe('matchSourceFromQuery', () => {
  it('matches "project iverson" → hashicorp/project-iverson', () => {
    const match = matchSourceFromQuery('project iverson', ENV_GITHUB);
    assert.ok(match);
    assert.equal(match.ref, 'hashicorp/project-iverson');
    assert.equal(match.provider, 'github');
  });

  it('matches "iverson" alone', () => {
    const match = matchSourceFromQuery('what is the status of iverson?', ENV_GITHUB);
    assert.ok(match);
    assert.equal(match.ref, 'hashicorp/project-iverson');
  });

  it('matches "cloud-reliability"', () => {
    const match = matchSourceFromQuery('cloud-reliability PRs', ENV_GITHUB);
    assert.ok(match);
    assert.equal(match.ref, 'hashicorp/cloud-reliability');
  });

  it('matches full repo path', () => {
    const match = matchSourceFromQuery('hashicorp/project-iverson', ENV_GITHUB);
    assert.ok(match);
    assert.equal(match.ref, 'hashicorp/project-iverson');
  });

  it('prefers longer/more specific match', () => {
    // "cloud-reliability" is longer than "cloud" — should win
    const env = { GITHUB_REPOS: 'org/cloud,org/cloud-reliability', GITHUB_TOKEN: 'x' };
    const match = matchSourceFromQuery('cloud-reliability issues', env);
    assert.equal(match.ref, 'org/cloud-reliability');
  });

  it('matches Jira project key', () => {
    const match = matchSourceFromQuery('PLAT sprint', ENV_JIRA);
    assert.ok(match);
    assert.equal(match.ref, 'PLAT');
    assert.equal(match.provider, 'jira');
  });

  it('matches Linear team', () => {
    const match = matchSourceFromQuery('platform team issues', ENV_LINEAR);
    assert.ok(match);
    assert.equal(match.provider, 'linear');
  });

  it('returns null for unrecognised query', () => {
    const match = matchSourceFromQuery('unrelated query about nothing', ENV_GITHUB);
    assert.equal(match, null);
  });

  it('returns null when no sources configured', () => {
    const match = matchSourceFromQuery('project iverson', {});
    assert.equal(match, null);
  });

  it('is case-insensitive', () => {
    const match = matchSourceFromQuery('Project Iverson updates', ENV_GITHUB);
    assert.ok(match);
    assert.equal(match.ref, 'hashicorp/project-iverson');
  });
});

// ── demandFetchAll (universal fetch) ─────────────────────────────────────────
describe('demandFetch — universal fallback', () => {
  it('returns no_providers when no credentials are set', async () => {
    const { demandFetch } = await import('../lib/embed/demand-fetch.mjs');
    const result = await demandFetch({ query: 'completely unknown thing', env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_providers');
  });

  it('returns no_match reason label when called with no_providers path', async () => {
    const { demandFetch } = await import('../lib/embed/demand-fetch.mjs');
    const result = await demandFetch({ query: 'unknown topic', env: {} });
    assert.ok(result.message.length > 0);
  });
});
