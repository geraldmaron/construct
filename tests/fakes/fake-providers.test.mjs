/**
 * tests/fakes/fake-providers.test.mjs — contract + behaviour tests for all fake providers.
 *
 * Run: node --test tests/fakes/fake-providers.test.mjs
 *
 * Verifies:
 *   - Each fake passes assertProviderContract from lib/providers/contract.mjs
 *   - Happy path creates work items and returns expected shape
 *   - Each failure mode throws with the correct status code and message
 *   - Duplicate detection returns the existing issue without creating a new one
 *   - reset() clears all state between tests
 *   - getCreatedIssues() / getCreatedPages() reflect only un-reset creations
 *
 * NETWORK GUARD: fakes never call fetch(); but we install a blocking guard
 * anyway so any accidental production code path that slips in will fail fast.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertProviderContract } from '../../lib/providers/contract.mjs';
import { FakeGitHub, FakeJira, FakeConfluence } from './index.mjs';

// Install network guard — any real fetch call during these tests is a bug.
globalThis.fetch = () => {
  throw new Error('Real network blocked in test — use fake providers');
};

// ── FakeGitHub ────────────────────────────────────────────────────────────────

describe('FakeGitHub — provider contract', () => {
  it('passes assertProviderContract', () => {
    const fake = FakeGitHub();
    assertProviderContract(fake);
  });

  it('has the expected meta shape', () => {
    const fake = FakeGitHub();
    assert.equal(fake.meta.id, 'fake-github');
    assert.ok(Array.isArray(fake.meta.capabilities));
    assert.ok(fake.meta.capabilities.includes('write'));
  });
});

describe('FakeGitHub — happy path', () => {
  let fake;
  beforeEach(() => { fake = FakeGitHub(); });

  it('createIssue returns id, number, and url', async () => {
    const result = await fake.createIssue('acme', 'api', { title: 'Fix the bug', body: 'Details here' });
    assert.ok(typeof result.id === 'number', 'id should be a number');
    assert.ok(typeof result.number === 'number', 'number should be a number');
    assert.match(result.url, /acme\/api\/issues\//);
  });

  it('url contains owner/repo and issue number', async () => {
    const result = await fake.createIssue('myorg', 'myrepo', { title: 'Issue A' });
    assert.ok(result.url.includes('myorg/myrepo/issues/'));
    assert.ok(result.url.endsWith(String(result.number)));
  });

  it('successive issues get incrementing numbers per repo', async () => {
    const a = await fake.createIssue('org', 'repo', { title: 'A' });
    const b = await fake.createIssue('org', 'repo', { title: 'B' });
    assert.ok(b.number > a.number);
  });

  it('stores labels when provided', async () => {
    await fake.createIssue('org', 'repo', { title: 'Labelled', labels: ['bug', 'urgent'] });
    const [issue] = fake.getCreatedIssues();
    assert.deepEqual(issue.labels, ['bug', 'urgent']);
  });

  it('getCreatedIssues returns all created issues', async () => {
    await fake.createIssue('org', 'repo', { title: 'One' });
    await fake.createIssue('org', 'repo', { title: 'Two' });
    assert.equal(fake.getCreatedIssues().length, 2);
  });

  it('write() contract method creates an issue via payload', async () => {
    const result = await fake.write({}, { type: 'issue', owner: 'o', repo: 'r', title: 'Via write' });
    assert.ok(result.url.includes('o/r/issues/'));
  });

  it('health() returns ok:true', async () => {
    const result = await fake.health();
    assert.equal(result.ok, true);
  });
});

describe('FakeGitHub — secondary-rate-limit mode', () => {
  let fake;
  beforeEach(() => { fake = FakeGitHub(); });

  it('throws an error with status 403 and "secondary rate limit" message', async () => {
    fake.setMode('secondary-rate-limit');
    const err = await fake.createIssue('o', 'r', { title: 'X' }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 403);
    assert.match(err.message, /secondary rate limit/i);
  });

  it('does not store any issue when the mode throws', async () => {
    fake.setMode('secondary-rate-limit');
    await fake.createIssue('o', 'r', { title: 'X' }).catch(() => {});
    assert.equal(fake.getCreatedIssues().length, 0);
  });
});

describe('FakeGitHub — duplicate mode', () => {
  let fake;
  beforeEach(() => { fake = FakeGitHub(); });

  it('second call with same title returns the existing issue', async () => {
    fake.setMode('duplicate');
    const first = await fake.createIssue('o', 'r', { title: 'Dupe Title' });
    const second = await fake.createIssue('o', 'r', { title: 'Dupe Title' });
    assert.equal(first.id, second.id);
    assert.equal(first.number, second.number);
    assert.equal(first.url, second.url);
  });

  it('only one issue is stored after two calls with the same title', async () => {
    fake.setMode('duplicate');
    await fake.createIssue('o', 'r', { title: 'Same' });
    await fake.createIssue('o', 'r', { title: 'Same' });
    assert.equal(fake.getCreatedIssues().length, 1);
  });

  it('different titles create distinct issues', async () => {
    fake.setMode('duplicate');
    const a = await fake.createIssue('o', 'r', { title: 'Alpha' });
    const b = await fake.createIssue('o', 'r', { title: 'Beta' });
    assert.notEqual(a.id, b.id);
    assert.equal(fake.getCreatedIssues().length, 2);
  });
});

describe('FakeGitHub — reset', () => {
  it('clears issues and reverts mode to normal', async () => {
    const fake = FakeGitHub();
    fake.setMode('duplicate');
    await fake.createIssue('o', 'r', { title: 'Before reset' });
    fake.reset();
    assert.equal(fake.getCreatedIssues().length, 0);
    // After reset, normal mode — should create without duplicate behaviour
    const result = await fake.createIssue('o', 'r', { title: 'After reset' });
    assert.ok(result.id);
    assert.equal(fake.getCreatedIssues().length, 1);
  });
});

// ── FakeJira ──────────────────────────────────────────────────────────────────

describe('FakeJira — provider contract', () => {
  it('passes assertProviderContract', () => {
    const fake = FakeJira();
    assertProviderContract(fake);
  });

  it('has the expected meta shape', () => {
    const fake = FakeJira();
    assert.equal(fake.meta.id, 'fake-jira');
    assert.ok(fake.meta.capabilities.includes('write'));
  });
});

describe('FakeJira — happy path', () => {
  let fake;
  beforeEach(() => { fake = FakeJira(); });

  it('createIssue returns id, key, and url', async () => {
    const result = await fake.createIssue('PROJ', { summary: 'New task', issuetype: 'Task' });
    assert.ok(typeof result.id === 'string');
    assert.match(result.key, /^PROJ-\d+$/);
    assert.match(result.url, /\/browse\/PROJ-/);
  });

  it('keys increment per project', async () => {
    const a = await fake.createIssue('PROJ', { summary: 'A' });
    const b = await fake.createIssue('PROJ', { summary: 'B' });
    const numA = parseInt(a.key.split('-')[1], 10);
    const numB = parseInt(b.key.split('-')[1], 10);
    assert.ok(numB > numA);
  });

  it('different projects have independent sequences', async () => {
    const a = await fake.createIssue('RLBLT', { summary: 'In RLBLT' });
    const b = await fake.createIssue('ENG', { summary: 'In ENG' });
    assert.match(a.key, /^RLBLT-/);
    assert.match(b.key, /^ENG-/);
  });

  it('getCreatedIssues returns all created issues', async () => {
    await fake.createIssue('PROJ', { summary: 'One' });
    await fake.createIssue('PROJ', { summary: 'Two' });
    assert.equal(fake.getCreatedIssues().length, 2);
  });

  it('write() contract method creates an issue via payload', async () => {
    const result = await fake.write({}, { type: 'issue', projectKey: 'MY', summary: 'Via write' });
    assert.match(result.key, /^MY-/);
  });

  it('health() returns ok:true', async () => {
    const result = await fake.health();
    assert.equal(result.ok, true);
  });
});

describe('FakeJira — adf-error mode', () => {
  let fake;
  beforeEach(() => { fake = FakeJira(); });

  it('throws with status 400 and ADF message', async () => {
    fake.setMode('adf-error');
    const err = await fake.createIssue('PROJ', { summary: 'X' }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 400);
    assert.match(err.message, /ADF validation failed/i);
  });

  it('does not store any issue when mode throws', async () => {
    fake.setMode('adf-error');
    await fake.createIssue('PROJ', { summary: 'X' }).catch(() => {});
    assert.equal(fake.getCreatedIssues().length, 0);
  });
});

describe('FakeJira — permission-denied mode', () => {
  let fake;
  beforeEach(() => { fake = FakeJira(); });

  it('throws with status 403 and Forbidden message', async () => {
    fake.setMode('permission-denied');
    const err = await fake.createIssue('PROJ', { summary: 'X' }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 403);
    assert.match(err.message, /Forbidden/i);
  });

  it('does not store any issue when mode throws', async () => {
    fake.setMode('permission-denied');
    await fake.createIssue('PROJ', { summary: 'X' }).catch(() => {});
    assert.equal(fake.getCreatedIssues().length, 0);
  });
});

describe('FakeJira — reset', () => {
  it('clears issues and reverts mode to normal', async () => {
    const fake = FakeJira();
    fake.setMode('adf-error');
    await fake.createIssue('PROJ', { summary: 'Before reset' }).catch(() => {});
    fake.reset();
    assert.equal(fake.getCreatedIssues().length, 0);
    const result = await fake.createIssue('PROJ', { summary: 'After reset' });
    assert.ok(result.key);
    assert.equal(fake.getCreatedIssues().length, 1);
  });
});

// ── FakeConfluence ────────────────────────────────────────────────────────────

describe('FakeConfluence — provider contract', () => {
  it('passes assertProviderContract', () => {
    const fake = FakeConfluence();
    assertProviderContract(fake);
  });

  it('has the expected meta shape', () => {
    const fake = FakeConfluence();
    assert.equal(fake.meta.id, 'fake-confluence');
    assert.ok(fake.meta.capabilities.includes('write'));
  });
});

describe('FakeConfluence — happy path', () => {
  let fake;
  beforeEach(() => { fake = FakeConfluence(); });

  it('createPage returns id, title, and url', async () => {
    const result = await fake.createPage('ENG', { title: 'RFC-001', body: '<p>Hello</p>' });
    assert.ok(typeof result.id === 'string');
    assert.equal(result.title, 'RFC-001');
    assert.match(result.url, /ENG/);
    assert.match(result.url, new RegExp(result.id));
  });

  it('each page gets a unique id', async () => {
    const a = await fake.createPage('ENG', { title: 'Page A' });
    const b = await fake.createPage('ENG', { title: 'Page B' });
    assert.notEqual(a.id, b.id);
  });

  it('getCreatedPages returns all created pages', async () => {
    await fake.createPage('ENG', { title: 'One' });
    await fake.createPage('ENG', { title: 'Two' });
    assert.equal(fake.getCreatedPages().length, 2);
  });

  it('write() contract method creates a page via payload', async () => {
    const result = await fake.write({}, { type: 'page', spaceKey: 'DOCS', title: 'Via write', body: '' });
    assert.ok(result.url.includes('DOCS'));
    assert.equal(result.title, 'Via write');
  });

  it('health() returns ok:true', async () => {
    const result = await fake.health();
    assert.equal(result.ok, true);
  });
});

describe('FakeConfluence — version-conflict mode', () => {
  let fake;
  beforeEach(() => { fake = FakeConfluence(); });

  it('throws with status 409 and Version conflict message', async () => {
    fake.setMode('version-conflict');
    const err = await fake.createPage('ENG', { title: 'X' }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 409);
    assert.match(err.message, /Version conflict/i);
  });

  it('does not store any page when mode throws', async () => {
    fake.setMode('version-conflict');
    await fake.createPage('ENG', { title: 'X' }).catch(() => {});
    assert.equal(fake.getCreatedPages().length, 0);
  });
});

describe('FakeConfluence — scope-denied mode', () => {
  let fake;
  beforeEach(() => { fake = FakeConfluence(); });

  it('throws with status 403 and Insufficient scope message', async () => {
    fake.setMode('scope-denied');
    const err = await fake.createPage('ENG', { title: 'X' }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 403);
    assert.match(err.message, /Insufficient scope/i);
  });

  it('does not store any page when mode throws', async () => {
    fake.setMode('scope-denied');
    await fake.createPage('ENG', { title: 'X' }).catch(() => {});
    assert.equal(fake.getCreatedPages().length, 0);
  });
});

describe('FakeConfluence — reset', () => {
  it('clears pages and reverts mode to normal', async () => {
    const fake = FakeConfluence();
    fake.setMode('version-conflict');
    await fake.createPage('ENG', { title: 'Before reset' }).catch(() => {});
    fake.reset();
    assert.equal(fake.getCreatedPages().length, 0);
    const result = await fake.createPage('ENG', { title: 'After reset' });
    assert.ok(result.id);
    assert.equal(fake.getCreatedPages().length, 1);
  });
});

// ── Cross-cutting: instance isolation ─────────────────────────────────────────

describe('Instance isolation', () => {
  it('two FakeGitHub instances do not share state', async () => {
    const a = FakeGitHub();
    const b = FakeGitHub();
    await a.createIssue('o', 'r', { title: 'In A' });
    assert.equal(a.getCreatedIssues().length, 1);
    assert.equal(b.getCreatedIssues().length, 0);
  });

  it('two FakeJira instances do not share state', async () => {
    const a = FakeJira();
    const b = FakeJira();
    await a.createIssue('P', { summary: 'In A' });
    assert.equal(a.getCreatedIssues().length, 1);
    assert.equal(b.getCreatedIssues().length, 0);
  });

  it('two FakeConfluence instances do not share state', async () => {
    const a = FakeConfluence();
    const b = FakeConfluence();
    await a.createPage('S', { title: 'In A' });
    assert.equal(a.getCreatedPages().length, 1);
    assert.equal(b.getCreatedPages().length, 0);
  });
});
