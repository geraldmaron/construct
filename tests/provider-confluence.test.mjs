/**
 * tests/provider-confluence.test.mjs — Confluence provider contract + unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runContractTests } from '../providers/lib/contract-tests.mjs';
import provider from '../providers/confluence/index.mjs';

runContractTests(provider);

describe('confluence provider — init requires credentials', () => {
  it('throws AuthError when env vars are missing', async () => {
    const p = Object.create(provider);
    await assert.rejects(
      () => p.init({ baseUrl: undefined, email: undefined, token: undefined }),
      (err) => err.code === 'AUTH_ERROR',
    );
  });
});

describe('confluence provider — unknown read ref', () => {
  it('throws NotFoundError for unknown ref', async () => {
    await assert.rejects(
      () => provider.read('bananas'),
      (err) => err.code === 'NOT_FOUND',
    );
  });
});

describe('confluence provider — unknown write type', () => {
  it('throws on unknown write type', async () => {
    await assert.rejects(
      () => provider.write({ type: 'unsupported' }),
      /Unknown Confluence write item type/,
    );
  });
});
