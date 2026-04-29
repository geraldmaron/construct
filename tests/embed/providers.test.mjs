/**
 * tests/embed/providers.test.mjs — Unit tests for embed provider modules.
 *
 * Uses a mock fetch to avoid real network calls. Tests:
 *   - GitHubProvider: prs, issues, commits (single + multi-repo)
 *   - SlackProvider:  messages (channel ID + name resolution)
 *   - LinearProvider: issues, cycles
 *   - JiraProvider:   issues, sprints
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GitHubProvider } from '../../lib/embed/providers/github.mjs';
import { SlackProvider } from '../../lib/embed/providers/slack.mjs';
import { LinearProvider } from '../../lib/embed/providers/linear.mjs';
import { JiraProvider } from '../../lib/embed/providers/jira.mjs';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function okJson(body) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockFetch(routes) {
  return async (url, opts) => {
    for (const [pattern, handler] of routes) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        const res = await handler(url, opts);
        return res;
      }
    }
    throw new Error(`mockFetch: unmatched URL: ${url}`);
  };
}

// ---------------------------------------------------------------------------
// GitHubProvider
// ---------------------------------------------------------------------------

test('GitHubProvider.read(prs) returns open PRs', async () => {
  const fetch = mockFetch([
    [
      '/pulls',
      okJson([
        { number: 1, title: 'Fix bug', html_url: 'https://github.com/o/r/pull/1',
          state: 'open', draft: false,
          user: { login: 'alice' },
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
          head: { ref: 'fix/bug' }, base: { ref: 'main' },
          labels: [], requested_reviewers: [] },
      ]),
    ],
  ]);

  const p = new GitHubProvider({ token: 't', fetchFn: fetch });
  const items = await p.read('prs', { repo: 'owner/repo' });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'pr');
  assert.equal(items[0].number, 1);
  assert.equal(items[0].title, 'Fix bug');
  assert.equal(items[0].repo, 'owner/repo');
});

test('GitHubProvider.read(prs) supports repos list', async () => {
  let callCount = 0;
  const fetch = mockFetch([
    [
      '/pulls',
      async () => {
        callCount++;
        return { ok: true, status: 200, json: async () => [] };
      },
    ],
  ]);

  const p = new GitHubProvider({ token: 't', fetchFn: fetch });
  await p.read('prs', { repos: ['o/a', 'o/b', 'o/c'] });
  assert.equal(callCount, 3);
});

test('GitHubProvider.read(issues) filters out pull requests', async () => {
  const fetch = mockFetch([
    [
      '/issues',
      okJson([
        { number: 10, title: 'Real issue', html_url: 'https://github.com/o/r/issues/10',
          state: 'open', user: { login: 'bob' },
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
          labels: [{ name: 'bug' }] },
        // GitHub includes PRs in /issues — should be filtered
        { number: 11, title: 'A PR', html_url: 'https://github.com/o/r/issues/11',
          state: 'open', user: { login: 'bob' }, pull_request: {},
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
          labels: [] },
      ]),
    ],
  ]);

  const p = new GitHubProvider({ token: 't', fetchFn: fetch });
  const items = await p.read('issues', { repo: 'owner/repo' });
  assert.equal(items.length, 1);
  assert.equal(items[0].number, 10);
});

test('GitHubProvider.read(commits) returns commit items', async () => {
  const fetch = mockFetch([
    [
      '/commits',
      okJson([
        { sha: 'abc123', commit: { message: 'feat: add thing', author: { name: 'Alice', date: '2026-01-01T00:00:00Z' } },
          html_url: 'https://github.com/o/r/commit/abc123', author: { login: 'alice' } },
      ]),
    ],
  ]);

  const p = new GitHubProvider({ token: 't', fetchFn: fetch });
  const items = await p.read('commits', { repo: 'owner/repo', branch: 'main' });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'commit');
  assert.equal(items[0].hash, 'abc123');
});

test('GitHubProvider returns error item for unknown ref', async () => {
  // Unknown refs are caught per-repo and surfaced as error items (not thrown)
  // so the snapshot stays partial rather than failing entirely.
  const p = new GitHubProvider({ token: 't', fetchFn: async () => {} });
  const items = await p.read('unknown', { repo: 'o/r' });
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'error');
  assert.ok(items[0].message.includes('unknown ref'));
});

test('GitHubProvider per-repo errors surface as error items', async () => {
  const fetch = mockFetch([
    [/.*/, async () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }), text: async () => 'Not Found' })],
  ]);

  const p = new GitHubProvider({ token: 't', fetchFn: fetch });
  const items = await p.read('prs', { repos: ['o/a', 'o/b'] });
  assert.ok(items.every((i) => i.type === 'error'));
  assert.equal(items.length, 2);
});

// ---------------------------------------------------------------------------
// SlackProvider
// ---------------------------------------------------------------------------

test('SlackProvider.read(messages) returns message items', async () => {
  const fetch = mockFetch([
    [
      'conversations.history',
      okJson({
        ok: true,
        messages: [
          { type: 'message', user: 'U123', text: 'Hello world', ts: '1700000000.000001', reactions: [] },
          { type: 'message', subtype: 'bot_message', user: 'B456', text: 'Bot msg', ts: '1700000001.000001' },
        ],
      }),
    ],
  ]);

  const p = new SlackProvider({ token: 't', fetchFn: fetch });
  const items = await p.read('messages', { channel: 'C12345678' });
  // bot_message (subtype) should be excluded
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'message');
  assert.equal(items[0].user, 'U123');
  assert.equal(items[0].text, 'Hello world');
});

test('SlackProvider resolves channel name to ID', async () => {
  let historyUrl = null;
  const fetch = mockFetch([
    [
      'conversations.list',
      okJson({ ok: true, channels: [{ id: 'C99999', name: 'general', name_normalized: 'general' }] }),
    ],
    [
      'conversations.history',
      async (url) => {
        historyUrl = url;
        return { ok: true, status: 200, json: async () => ({ ok: true, messages: [] }) };
      },
    ],
  ]);

  const p = new SlackProvider({ token: 't', fetchFn: fetch });
  await p.read('messages', { channel: 'general' });
  assert.ok(historyUrl?.includes('C99999'), `Expected C99999 in URL, got: ${historyUrl}`);
});

test('SlackProvider reads multiple channels', async () => {
  let callCount = 0;
  const fetch = mockFetch([
    [
      'conversations.history',
      async () => {
        callCount++;
        return { ok: true, status: 200, json: async () => ({ ok: true, messages: [] }) };
      },
    ],
  ]);

  const p = new SlackProvider({ token: 't', fetchFn: fetch });
  await p.read('messages', { channels: ['C111111111', 'C222222222', 'C333333333'] });
  assert.equal(callCount, 3);
});

test('SlackProvider throws on unknown ref', async () => {
  const p = new SlackProvider({ token: 't', fetchFn: async () => {} });
  await assert.rejects(() => p.read('unknown', {}), /unknown ref/);
});

test('SlackProvider requires channel or channels', async () => {
  const p = new SlackProvider({ token: 't', fetchFn: async () => {} });
  await assert.rejects(() => p.read('messages', {}), /channel/);
});

// ---------------------------------------------------------------------------
// LinearProvider
// ---------------------------------------------------------------------------

const LINEAR_ISSUES_RESPONSE = {
  issues: {
    nodes: [
      { id: 'i1', identifier: 'ENG-42', title: 'Build thing', description: 'Details',
        priority: 2, priorityLabel: 'Medium',
        state: { name: 'In Progress', type: 'started' },
        assignee: { name: 'Alice' },
        team: { name: 'Engineering', key: 'ENG' },
        project: { name: 'Q2' },
        url: 'https://linear.app/team/issue/ENG-42',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-10T00:00:00Z',
        labels: { nodes: [{ name: 'frontend' }] } },
    ],
  },
};

test('LinearProvider.read(issues) returns issue items', async () => {
  const fetch = mockFetch([
    [LINEAR_API_URL, okJson({ data: LINEAR_ISSUES_RESPONSE })],
  ]);

  const p = new LinearProvider({ apiKey: 'lin_api_xxx', fetchFn: fetch });
  const items = await p.read('issues', { team: 'ENG' });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'ENG-42');
  assert.equal(items[0].assignee, 'Alice');
  assert.deepEqual(items[0].labels, ['frontend']);
});

test('LinearProvider.read(cycles) returns cycle issue items', async () => {
  const cycleResponse = {
    cycles: {
      nodes: [{
        id: 'c1', name: 'Sprint 5', number: 5,
        startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-01-14T00:00:00Z',
        team: { name: 'Engineering', key: 'ENG' },
        issues: {
          nodes: [
            { id: 'i2', identifier: 'ENG-43', title: 'Cycle task',
              state: { name: 'Todo', type: 'unstarted' },
              assignee: null, priority: 0, priorityLabel: 'No Priority',
              url: 'https://linear.app/team/issue/ENG-43',
              updatedAt: '2026-01-05T00:00:00Z' },
          ],
        },
      }],
    },
  };

  const fetch = mockFetch([
    [LINEAR_API_URL, okJson({ data: cycleResponse })],
  ]);

  const p = new LinearProvider({ apiKey: 'lin_api_xxx', fetchFn: fetch });
  const items = await p.read('cycles', { team: 'ENG' });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'ENG-43');
  assert.equal(items[0].cycle, 'ENG Cycle 5');
});

test('LinearProvider.read(cycles) returns empty when no active cycle', async () => {
  const fetch = mockFetch([
    [LINEAR_API_URL, okJson({ data: { cycles: { nodes: [] } } })],
  ]);

  const p = new LinearProvider({ apiKey: 'lin_api_xxx', fetchFn: fetch });
  const items = await p.read('cycles', {});
  assert.deepEqual(items, []);
});

test('LinearProvider throws on unknown ref', async () => {
  const p = new LinearProvider({ apiKey: 'lin_api_xxx', fetchFn: async () => {} });
  await assert.rejects(() => p.read('unknown', {}), /unknown ref/);
});

// ---------------------------------------------------------------------------
// JiraProvider
// ---------------------------------------------------------------------------

const JIRA_ISSUES_RESPONSE = {
  issues: [
    {
      key: 'PROJ-1', id: '10001',
      fields: {
        summary: 'Fix login flow',
        status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
        assignee: { displayName: 'Bob' },
        priority: { name: 'High' },
        issuetype: { name: 'Story' },
        labels: ['auth'],
        created: '2026-01-01T00:00:00Z',
        updated: '2026-01-10T00:00:00Z',
      },
    },
  ],
};

test('JiraProvider.read(issues) returns issue items', async () => {
  const fetch = mockFetch([
    ['/rest/api/3/search', okJson(JIRA_ISSUES_RESPONSE)],
  ]);

  const p = new JiraProvider({
    baseUrl: 'https://example.atlassian.net',
    email: 'user@example.com',
    token: 'tok',
    fetchFn: fetch,
  });
  const items = await p.read('issues', { project: 'PROJ' });
  assert.equal(items.length, 1);
  assert.equal(items[0].key, 'PROJ-1');
  assert.equal(items[0].assignee, 'Bob');
  assert.equal(items[0].status, 'In Progress');
  assert.deepEqual(items[0].labels, ['auth']);
});

test('JiraProvider.read(issues) uses provided JQL override', async () => {
  let capturedBody = null;
  const fetch = mockFetch([
    [
      '/rest/api/3/search',
      async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ issues: [] }) };
      },
    ],
  ]);

  const p = new JiraProvider({ baseUrl: 'https://x.atlassian.net', email: 'u@e.com', token: 't', fetchFn: fetch });
  await p.read('issues', { jql: 'project = FOO AND sprint in openSprints()' });
  assert.equal(capturedBody?.jql, 'project = FOO AND sprint in openSprints()');
});

test('JiraProvider.read(issues) builds JQL from multiple projects', async () => {
  let capturedBody = null;
  const fetch = mockFetch([
    ['/rest/api/3/search', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ issues: [] }) };
    }],
  ]);

  const p = new JiraProvider({ baseUrl: 'https://x.atlassian.net', email: 'u@e.com', token: 't', fetchFn: fetch });
  await p.read('issues', { projects: ['ALPHA', 'BETA'] });
  assert.ok(capturedBody?.jql.includes('"ALPHA"'));
  assert.ok(capturedBody?.jql.includes('"BETA"'));
});

test('JiraProvider throws on unknown ref', async () => {
  const p = new JiraProvider({ baseUrl: 'https://x.atlassian.net', email: 'u@e.com', token: 't', fetchFn: async () => {} });
  await assert.rejects(() => p.read('unknown', {}), /unknown ref/);
});

// ---------------------------------------------------------------------------
// Shared constant needed by Linear tests
// ---------------------------------------------------------------------------

const LINEAR_API_URL = 'api.linear.app';
