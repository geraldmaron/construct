/**
 * tests/provider-jira.test.mjs — Jira provider contract + unit tests.
 *
 * Live API calls require JIRA_URL, JIRA_EMAIL, JIRA_TOKEN env vars.
 * Those tests are skipped when credentials are absent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContractTests } from '../providers/lib/contract-tests.mjs';
import provider from '../providers/jira/index.mjs';

runContractTests(provider);

describe('jira provider — webhook normalization', () => {
  it('normalizes a Jira webhook event', async () => {
    const event = { webhookEvent: 'jira:issue_updated', issue: { key: 'PROJ-1' } };
    const result = await provider.webhook(event);
    assert.equal(result.provider, 'jira');
    assert.equal(result.type, 'jira:issue_updated');
    assert.deepEqual(result.raw, event);
  });

  it('handles unknown event gracefully', async () => {
    const result = await provider.webhook({});
    assert.equal(result.type, 'unknown');
  });
});

describe('jira provider — init requires credentials', () => {
  it('throws AuthError when env vars are missing', async () => {
    const p = Object.create(provider);
    await assert.rejects(
      () => p.init({ baseUrl: undefined, email: undefined, token: undefined }),
      (err) => err.code === 'AUTH_ERROR',
    );
  });
});

describe('jira provider — unknown write type', () => {
  it('throws on unknown write type', async () => {
    await assert.rejects(
      () => provider.write({ type: 'unsupported-type' }),
      /Unknown Jira write item type/,
    );
  });
});
