/**
 * tests/source-targets.test.mjs — typed source targets validation and resolution.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  validateSourceTargets,
  mergeSourceTargets,
  legacyEnvSourceTargets,
  resolveEffectiveSourceTargetsFromConfig,
  targetsToEmbedSources,
  targetSignature,
  resolveTeamSources,
  targetsToEmbedSourcesWithFilters,
} from '../lib/config/source-targets.mjs';
import { DEFAULT_PROJECT_CONFIG } from '../lib/config/schema.mjs';

describe('validateSourceTargets', () => {
  it('accepts valid provider selectors', () => {
    const errors = validateSourceTargets([
      { id: 'gh-main', provider: 'github', selector: { repo: 'org/repo' } },
      { id: 'jira-plat', provider: 'jira', selector: { project: 'PLAT' } },
      { id: 'linear-eng', provider: 'linear', selector: { team: 'ENG' } },
      { id: 'slack-eng', provider: 'slack', selector: { channel: 'eng', intent: 'risk' } },
    ]);
    assert.deepEqual(errors, []);
  });

  it('rejects duplicate ids', () => {
    const errors = validateSourceTargets([
      { id: 'dup', provider: 'github', selector: { repo: 'a/b' } },
      { id: 'dup', provider: 'github', selector: { repo: 'c/d' } },
    ]);
    assert.ok(errors.some((e) => e.includes('duplicate id')));
  });

  it('rejects invalid github repo slug', () => {
    const errors = validateSourceTargets([
      { id: 'bad', provider: 'github', selector: { repo: 'not-a-repo' } },
    ]);
    assert.ok(errors.some((e) => e.includes('selector.repo')));
  });
});

describe('mergeSourceTargets', () => {
  it('deduplicates by provider+selector signature', () => {
    const config = [{ id: 'gh', provider: 'github', selector: { repo: 'org/repo' } }];
    const env = [{ id: 'env-gh', provider: 'github', selector: { repo: 'org/repo' }, provenance: 'env' }];
    const merged = mergeSourceTargets(config, env);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'gh');
  });
});

describe('legacyEnvSourceTargets', () => {
  it('maps env lists to synthetic targets', () => {
    const targets = legacyEnvSourceTargets({
      GITHUB_REPOS: 'org/a,org/b',
      JIRA_PROJECTS: 'PLAT',
      LINEAR_TEAMS: 'platform',
      SLACK_CHANNELS: '#eng:risk',
    });
    assert.equal(targets.filter((t) => t.provider === 'github').length, 2);
    assert.ok(targets.some((t) => t.provider === 'jira' && t.selector.project === 'PLAT'));
    assert.ok(targets.some((t) => t.provider === 'slack' && t.selector.intent === 'risk'));
  });
});

describe('resolveEffectiveSourceTargetsFromConfig', () => {
  it('merges config targets with env targets', () => {
    const config = {
      ...DEFAULT_PROJECT_CONFIG,
      sources: { targets: [{ id: 'gh', provider: 'github', selector: { repo: 'org/x' } }] },
    };
    const effective = resolveEffectiveSourceTargetsFromConfig(config, { GITHUB_REPOS: 'org/y' });
    assert.equal(effective.length, 2);
    assert.ok(effective.some((t) => t.selector.repo === 'org/x'));
    assert.ok(effective.some((t) => t.selector.repo === 'org/y'));
  });
});

describe('targetsToEmbedSources', () => {
  it('groups github repos into activity and context source records', () => {
    const sources = targetsToEmbedSources([
      { id: 'gh', provider: 'github', selector: { repo: 'org/repo' } },
    ]);
    assert.equal(sources.length, 2);
    assert.ok(sources.every((s) => s.provider === 'github'));
    assert.deepEqual(sources[0].repos, ['org/repo']);
  });

  it('uses stable signatures for slack intent grouping', () => {
    const sigA = targetSignature({ provider: 'slack', selector: { channel: 'eng', intent: 'risk' } });
    const sigB = targetSignature({ provider: 'slack', selector: { channel: 'eng', intent: 'internal' } });
    assert.notEqual(sigA, sigB);
  });
});

describe('resolveTeamSources', () => {
  const registry = {
    teams: {
      'engineering-group': {
        sources: [
          { id: 'main-repo', provider: 'github', selector: { repo: 'anthropic/construct' }, filters: { refs: ['prs'], limit: 10 } },
          { id: 'plat-jira', provider: 'jira', selector: { project: 'PLAT' }, filters: { jql: 'status != Done' } },
        ],
      },
    },
  };

  it('resolves a team\'s declared sources with provenance and filters preserved', () => {
    const targets = resolveTeamSources('engineering-group', { registry, config: {}, env: {} });
    assert.equal(targets.length, 2);
    const gh = targets.find((t) => t.provider === 'github');
    assert.equal(gh.provenance, 'team:engineering-group');
    assert.deepEqual(gh.filters, { refs: ['prs'], limit: 10 });
  });

  it('returns no targets for an unknown team', () => {
    assert.equal(resolveTeamSources('nope', { registry, config: {}, env: {} }).length, 0);
  });

  it('merges team bindings ahead of project config by typed signature', () => {
    const config = { sources: { targets: [{ id: 'other-repo', provider: 'github', selector: { repo: 'acme/other' } }] } };
    const targets = resolveTeamSources('engineering-group', { registry, config, env: {} });
    const repos = targets.filter((t) => t.provider === 'github').map((t) => t.selector.repo);
    assert.ok(repos.includes('anthropic/construct'));
    assert.ok(repos.includes('acme/other'));
  });
});

describe('targetsToEmbedSourcesWithFilters', () => {
  it('honors per-target filters and tags records with teamId + targetId', () => {
    const targets = resolveTeamSources('engineering-group', {
      registry: {
        teams: { 'engineering-group': { sources: [
          { id: 'main-repo', provider: 'github', selector: { repo: 'anthropic/construct' }, filters: { refs: ['prs'], limit: 10 } },
          { id: 'plat-jira', provider: 'jira', selector: { project: 'PLAT' }, filters: { jql: 'status != Done' } },
        ] } },
      },
      config: {}, env: {},
    });
    const sources = targetsToEmbedSourcesWithFilters(targets, { teamId: 'engineering-group' });
    const gh = sources.find((s) => s.provider === 'github');
    assert.deepEqual(gh.refs, ['prs']);
    assert.equal(gh.limit, 10);
    assert.equal(gh.teamId, 'engineering-group');
    assert.equal(gh.targetId, 'main-repo');
    const jira = sources.find((s) => s.provider === 'jira');
    assert.equal(jira.jql, 'status != Done');
    assert.equal(jira.targetId, 'plat-jira');
  });

  it('falls back to default refs/limit when a target has no filters', () => {
    const sources = targetsToEmbedSourcesWithFilters(
      [{ id: 'r', provider: 'github', selector: { repo: 'a/b' } }],
      {},
    );
    assert.deepEqual(sources[0].refs, ['prs', 'issues', 'commits']);
    assert.equal(sources[0].limit, 25);
  });
});
