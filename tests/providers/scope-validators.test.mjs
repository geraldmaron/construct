/**
 * tests/providers/scope-validators.test.mjs — allowlist scope validation tests.
 *
 * Verifies:
 *   - validateAllowlist returns allowed=true when no allowlist is configured.
 *   - validateAllowlist returns allowed=false when the target is not in repoAllowlist.
 *   - validateAllowlist returns allowed=true when the target matches repoAllowGlob.
 *   - Unknown providers pass through (no schema defined).
 *   - Glob patterns are single-segment (no slash crossing).
 *   - The real github provider's read()/search() (lib/providers/github/index.mjs)
 *     enforce repoAllowlist/repoAllowGlob end-to-end: a blocked target throws
 *     OUT_OF_SCOPE before any network call, an allowed target proceeds, and an
 *     unconfigured allowlist never blocks (construct-hb9k).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAllowlist } from '../../lib/providers/contract.mjs';

describe('validateAllowlist — no allowlist configured', () => {
  it('returns allowed=true when config has no allowlist fields', () => {
    const result = validateAllowlist('github', 'any-repo', {});
    assert.equal(result.allowed, true);
  });

  it('returns allowed=true when config is undefined', () => {
    const result = validateAllowlist('github', 'any-repo');
    assert.equal(result.allowed, true);
  });

  it('returns allowed=true for an unknown provider', () => {
    const result = validateAllowlist('unknown-provider', 'any-target', {});
    assert.equal(result.allowed, true);
  });
});

describe('validateAllowlist — repoAllowlist', () => {
  it('returns allowed=false when target is not in repoAllowlist', () => {
    const result = validateAllowlist('github', 'blocked-repo', {
      repoAllowlist: ['allowed-repo', 'other-repo'],
    });
    assert.equal(result.allowed, false);
    assert.ok(result.reason.includes('blocked-repo'));
  });

  it('returns allowed=true when target is in repoAllowlist', () => {
    const result = validateAllowlist('github', 'allowed-repo', {
      repoAllowlist: ['allowed-repo', 'other-repo'],
    });
    assert.equal(result.allowed, true);
  });

  it('returns allowed=false for empty repoAllowlist with a glob set', () => {
    const result = validateAllowlist('github', 'blocked-repo', {
      repoAllowlist: [],
      repoAllowGlob: 'frontend-*',
    });
    assert.equal(result.allowed, false);
  });
});

describe('validateAllowlist — repoAllowGlob', () => {
  it('returns allowed=true when target matches repoAllowGlob', () => {
    const result = validateAllowlist('github', 'frontend-payments', {
      repoAllowGlob: 'frontend-*',
    });
    assert.equal(result.allowed, true);
    assert.match(result.reason, /frontend-\*/);
  });

  it('returns allowed=false when target does not match repoAllowGlob', () => {
    const result = validateAllowlist('github', 'backend-api', {
      repoAllowGlob: 'frontend-*',
    });
    assert.equal(result.allowed, false);
  });

  it('glob does not cross path separators', () => {
    const result = validateAllowlist('github', 'frontend/sub', {
      repoAllowGlob: 'frontend-*',
    });
    assert.equal(result.allowed, false);
  });

  it('exact glob match works', () => {
    const result = validateAllowlist('github', 'backend', {
      repoAllowGlob: 'backend',
    });
    assert.equal(result.allowed, true);
  });
});

describe('validateAllowlist — other providers', () => {
  it('blocks jira project not in projectAllowlist', () => {
    const result = validateAllowlist('atlassian-jira', 'BACKEND', {
      projectAllowlist: ['FRONTEND', 'INFRA'],
    });
    assert.equal(result.allowed, false);
  });

  it('allows slack channel in channelAllowlist', () => {
    const result = validateAllowlist('slack', 'C012AB3CD', {
      channelAllowlist: ['C012AB3CD', 'C999XYZ'],
    });
    assert.equal(result.allowed, true);
  });
});

describe('OUT_OF_SCOPE error code from provider read()', () => {
  it('throws an OUT_OF_SCOPE error when read() is called with a blocked resource, before any network request', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async (...args) => {
      fetchCalled = true;
      return originalFetch(...args);
    };

    try {
      await assert.rejects(
        () => provider.read({ repo: 'blocked-repo', repoAllowlist: ['allowed-repo'] }),
        (err) => err.code === 'OUT_OF_SCOPE',
      );
      assert.equal(fetchCalled, false, 'read() must reject before making any network request');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('allows read() through when the target matches repoAllowlist (network call proceeds)', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ name: 'allowed-repo' }) };
    };

    try {
      await provider.read({ repo: 'allowed-repo', repoAllowlist: ['allowed-repo'] });
      assert.equal(fetchCalled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not block read() when no allowlist is configured (network call proceeds)', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ name: 'any-repo' }) };
    };

    try {
      await provider.read({ repo: 'any-repo' });
      assert.equal(fetchCalled, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws OUT_OF_SCOPE for search() when repoAllowlist is configured but the query has no repo: qualifier', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    await assert.rejects(
      () => provider.search({ kind: 'issues', query: 'is:open label:bug', repoAllowlist: ['allowed-repo'] }),
      (err) => err.code === 'OUT_OF_SCOPE',
    );
  });

  it('throws OUT_OF_SCOPE for search() when the query repo: qualifier is not in repoAllowlist', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    await assert.rejects(
      () => provider.search({ kind: 'issues', query: 'is:open repo:acme/blocked-repo', repoAllowlist: ['allowed-repo'] }),
      (err) => err.code === 'OUT_OF_SCOPE',
    );
  });

  it('allows search() through when the query repo: qualifier matches repoAllowlist', async () => {
    const { create } = await import('../../lib/providers/github/index.mjs');
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });

    try {
      const items = await provider.search({ kind: 'issues', query: 'is:open repo:acme/allowed-repo', repoAllowlist: ['allowed-repo'] });
      assert.deepEqual(items, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validateAllowlist result can be used to throw OUT_OF_SCOPE', () => {
    const check = validateAllowlist('github', 'blocked', { repoAllowlist: ['allowed'] });
    assert.equal(check.allowed, false);

    const err = Object.assign(new Error(check.reason), { code: 'OUT_OF_SCOPE' });
    assert.equal(err.code, 'OUT_OF_SCOPE');
    assert.ok(err.message.includes('blocked'));
  });
});
