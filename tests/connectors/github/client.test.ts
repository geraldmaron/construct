/**
 * tests/connectors/github/client.test.ts — the pure half: locator parsing
 * and turning gh's JSON answers into typed results, exercised with literal
 * strings so none of it needs a process to run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ghFailureReason,
  parseCreatedIssueResponse,
  parseRepoLocator,
  parseSearchIssuesResponse,
} from '../../../src/connectors/github/connector.ts';

test('a locator splits into owner and repo', () => {
  assert.deepEqual(parseRepoLocator('acme/website'), { owner: 'acme', repo: 'website' });
  assert.deepEqual(parseRepoLocator('  acme/website  '), { owner: 'acme', repo: 'website' });
});

test('a locator with no slash, or more than one, does not parse', () => {
  assert.equal(parseRepoLocator('website'), null);
  assert.equal(parseRepoLocator('acme/website/extra'), null);
  assert.equal(parseRepoLocator(''), null);
});

test('a search response reports its exact total and each issue by url', () => {
  const raw = JSON.stringify({
    total_count: 2,
    items: [
      {
        number: 42,
        title: 'Fix login bug',
        body: 'Steps to reproduce',
        html_url: 'https://github.com/acme/website/issues/42',
        updated_at: '2026-08-20T12:00:00Z',
      },
      {
        number: 41,
        title: 'Typo on homepage',
        body: '',
        html_url: 'https://github.com/acme/website/issues/41',
        updated_at: '2026-08-19T09:00:00Z',
      },
    ],
  });
  const result = parseSearchIssuesResponse(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.totalCount, 2);
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.issues[0], {
    number: 42,
    title: 'Fix login bug',
    body: 'Steps to reproduce',
    url: 'https://github.com/acme/website/issues/42',
    updatedAt: '2026-08-20T12:00:00Z',
  });
});

test('a search response missing total_count or items is refused, not guessed at', () => {
  assert.equal(parseSearchIssuesResponse('{}').ok, false);
  assert.equal(parseSearchIssuesResponse('{"total_count": 3}').ok, false);
  assert.equal(parseSearchIssuesResponse('not json').ok, false);
});

test('an item missing its number or url is dropped rather than recorded half-true', () => {
  const raw = JSON.stringify({ total_count: 1, items: [{ title: 'no number or url' }] });
  const result = parseSearchIssuesResponse(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.issues.length, 0);
  assert.equal(result.totalCount, 1, 'the exact total is kept even though the row could not be used');
});

test('a created-issue response is read for its number and url', () => {
  const raw = JSON.stringify({
    number: 43,
    html_url: 'https://github.com/acme/website/issues/43',
    title: 'New issue',
  });
  assert.deepEqual(parseCreatedIssueResponse(raw), {
    ok: true,
    number: 43,
    url: 'https://github.com/acme/website/issues/43',
  });
});

test('a created-issue response with no number or url is refused', () => {
  assert.equal(parseCreatedIssueResponse('{"title":"x"}').ok, false);
  assert.equal(parseCreatedIssueResponse('not json').ok, false);
});

test('a failure reason prefers stderr, and names the status when stderr is empty', () => {
  assert.equal(
    ghFailureReason({ status: 1, stdout: '', stderr: 'HTTP 404: Not Found' }),
    'HTTP 404: Not Found',
  );
  assert.match(ghFailureReason({ status: 1, stdout: '', stderr: '' }), /status 1/);
  assert.match(ghFailureReason({ status: null, stdout: '', stderr: '' }), /could not be started/);
});
