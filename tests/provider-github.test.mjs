/**
 * tests/provider-github.test.mjs — GitHub provider contract + unit tests.
 *
 * Functional calls require gh CLI authentication. Those tests are skipped
 * when GITHUB_TOKEN is absent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContractTests } from '../providers/lib/contract-tests.mjs';
import provider from '../providers/github/index.mjs';
import { CapabilityNotSupported } from '../providers/lib/errors.mjs';

runContractTests(provider);

describe('github provider — webhook normalization', () => {
  it('normalizes a PR event', async () => {
    const event = { type: 'pull_request', action: 'opened', number: 42 };
    const result = await provider.webhook(event);
    assert.equal(result.provider, 'github');
    assert.equal(result.type, 'pull_request.opened');
    assert.deepEqual(result.raw, event);
  });

  it('handles event without action', async () => {
    const event = { type: 'ping' };
    const result = await provider.webhook(event);
    assert.equal(result.type, 'ping');
  });
});

describe('github provider — write item types', () => {
  it('throws on unknown write type without live gh', async () => {
    await assert.rejects(
      () => provider.write({ type: 'unknown-type' }),
      /Unknown GitHub write item type/,
    );
  });
});
