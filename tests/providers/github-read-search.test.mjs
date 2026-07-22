/**
 * tests/providers/github-read-search.test.mjs — real read()/search()/health()
 * behavior for lib/providers/github/index.mjs against an injected fetch
 * boundary (construct-4uxq0.13.3, Phase 9 audit checklist items "rate-limit"
 * and "permission-failure" behavior, plus the auth-header path a private-repo
 * request depends on).
 *
 * globalThis.fetch is the real injected wire boundary this module calls
 * through — no HTTP server is spun up because the API base URL
 * (https://api.github.com) is not parameterized in the module, so intercepting
 * the fetch global is the only way to exercise ghFetch()'s real status/header
 * handling without a live network call. This is the same injection point
 * tests/providers/scope-validators.test.mjs already uses for this module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../lib/providers/github/index.mjs';

function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return run(calls).finally(() => { globalThis.fetch = original; });
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? 'Forbidden' : status === 401 ? 'Unauthorized' : 'Error',
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('github provider — rate-limit response handling', () => {
  it('read() surfaces a 403 rate-limit response as a thrown error carrying status and remaining count', async () => {
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });
    await withFetch(
      () => jsonResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
      async () => {
        await assert.rejects(
          () => provider.read({ repo: 'acme/widgets' }),
          (err) => {
            assert.equal(err.status, 403);
            assert.equal(err.rateLimitRemaining, 0);
            assert.match(err.message, /403/);
            return true;
          },
        );
      },
    );
  });

  it('search() surfaces a 403 rate-limit response the same way as read()', async () => {
    const provider = create({ env: { GITHUB_TOKEN: 'fake' } });
    await withFetch(
      () => jsonResponse(403, { message: 'secondary rate limit' }, { 'x-ratelimit-remaining': '0' }),
      async () => {
        await assert.rejects(
          () => provider.search({ kind: 'issues', query: 'is:open' }),
          (err) => err.status === 403 && err.rateLimitRemaining === 0,
        );
      },
    );
  });
});

describe('github provider — permission-failure response handling', () => {
  it('read() surfaces a 401 (bad/expired token) as a thrown error carrying status 401', async () => {
    const provider = create({ env: { GITHUB_TOKEN: 'expired' } });
    await withFetch(
      () => jsonResponse(401, { message: 'Bad credentials' }),
      async () => {
        await assert.rejects(
          () => provider.read({ repo: 'acme/private-repo' }),
          (err) => err.status === 401,
        );
      },
    );
  });

  it('read() surfaces a 404 (private repo, no read access) distinctly from a 401', async () => {
    const provider = create({ env: {} });
    await withFetch(
      () => jsonResponse(404, { message: 'Not Found' }),
      async () => {
        await assert.rejects(
          () => provider.read({ repo: 'acme/private-repo' }),
          (err) => err.status === 404 && err.status !== 401,
        );
      },
    );
  });
});

describe('github provider — auth header composition (private-repo access path)', () => {
  it('sends an Authorization: Bearer header when GITHUB_TOKEN is set', async () => {
    const provider = create({ env: { GITHUB_TOKEN: 'secret-token-123' } });
    await withFetch(
      () => jsonResponse(200, { name: 'widgets' }),
      async (calls) => {
        await provider.read({ repo: 'acme/widgets' });
        assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token-123');
      },
    );
  });

  it('falls back to GH_TOKEN when GITHUB_TOKEN is absent', async () => {
    const provider = create({ env: { GH_TOKEN: 'gh-cli-token' } });
    await withFetch(
      () => jsonResponse(200, { name: 'widgets' }),
      async (calls) => {
        await provider.read({ repo: 'acme/widgets' });
        assert.equal(calls[0].init.headers.Authorization, 'Bearer gh-cli-token');
      },
    );
  });

  it('sends no Authorization header when neither token is configured (unauthenticated, rate-limited access only)', async () => {
    const provider = create({ env: {} });
    await withFetch(
      () => jsonResponse(200, { name: 'widgets' }),
      async (calls) => {
        await provider.read({ repo: 'acme/widgets' });
        assert.equal(calls[0].init.headers.Authorization, undefined);
      },
    );
  });
});

describe('github provider — health()', () => {
  it('reports authenticated:true and the real rate-limit shape when a token is present', async () => {
    const provider = create({ env: { GITHUB_TOKEN: 'secret-token-123' } });
    await withFetch(
      () => ({
        ok: true,
        json: async () => ({ resources: { core: { limit: 5000, remaining: 4999 } } }),
      }),
      async () => {
        const result = await provider.health();
        assert.equal(result.ok, true);
        assert.equal(result.authenticated, true);
        assert.match(result.detail, /5000 req\/h limit; 4999 remaining/);
      },
    );
  });

  it('reports authenticated:false when no token is configured', async () => {
    const provider = create({ env: {} });
    await withFetch(
      () => ({ ok: true, json: async () => ({ resources: { core: { limit: 60, remaining: 12 } } }) }),
      async () => {
        const result = await provider.health();
        assert.equal(result.authenticated, false);
      },
    );
  });

  it('reports ok:false when the rate_limit endpoint itself fails', async () => {
    const provider = create({ env: {} });
    await withFetch(
      () => ({ ok: false, status: 500 }),
      async () => {
        const result = await provider.health();
        assert.equal(result.ok, false);
        assert.match(result.detail, /rate_limit endpoint 500/);
      },
    );
  });
});
