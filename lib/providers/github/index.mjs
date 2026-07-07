/**
 * lib/providers/github/index.mjs — GitHub data-source provider.
 *
 * Capabilities: read, search, webhook.
 *
 * Auth: reads `GITHUB_TOKEN` (or `GH_TOKEN`) from env. Without a token,
 * unauthenticated GitHub API rate limits apply (60 req/h/IP).
 *
 * Config (per call):
 *   - repo:       "owner/name" — required for read
 *   - query:      free-text search (issues, PRs, code) for search
 *   - kind:       'issues' | 'prs' | 'code' (default 'issues')
 *
 * The provider is intentionally narrow in v1 — issue + PR + code search +
 * a single repo metadata read. Webhook signature verification is in place
 * so consumers can mount a receiver without re-implementing it.
 *
 * Scope enforcement: when `repoAllowlist` or `repoAllowGlob` is present in
 * config, `read()` validates `config.repo` and `search()` validates every
 * `repo:` qualifier in the query through `validateAllowlist()`
 * (lib/providers/contract.mjs) before any network call, throwing a typed
 * `OUT_OF_SCOPE` error on a blocked target. A search query with no `repo:`
 * qualifier is rejected outright when an allowlist is configured — an
 * unscoped query could otherwise span the whole credential's visible
 * surface and defeat the allowlist.
 */

import crypto from 'node:crypto';

import { validateAllowlist } from '../contract.mjs';

const API = 'https://api.github.com';

function authHeader(env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function outOfScopeError(reason) {
  return Object.assign(new Error(reason), { code: 'OUT_OF_SCOPE' });
}

async function ghFetch(pathOrUrl, env, init = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'construct-github-provider',
    ...authHeader(env),
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GitHub ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
    err.status = res.status;
    err.rateLimitRemaining = Number(res.headers.get('x-ratelimit-remaining'));
    throw err;
  }
  return res.json();
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'github',
      displayName: 'GitHub',
      capabilities: ['read', 'search', 'webhook'],
      description: 'Repos, issues, PRs, and code search.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        repo: { type: 'string', pattern: '^[^/]+/[^/]+$', description: 'owner/name' },
        kind: { enum: ['issues', 'prs', 'code'], default: 'issues' },
        query: { type: 'string' },
        webhookSecret: { type: 'string', description: 'webhook signature secret' },
      },
    },

    async health() {
      try {
        const r = await fetch(`${API}/rate_limit`, { headers: authHeader(env) });
        if (!r.ok) return { ok: false, detail: `rate_limit endpoint ${r.status}` };
        const data = await r.json();
        const remaining = data?.resources?.core?.remaining;
        return {
          ok: true,
          detail: `${data?.resources?.core?.limit || 0} req/h limit; ${remaining ?? 0} remaining`,
          authenticated: !!(env.GITHUB_TOKEN || env.GH_TOKEN),
        };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    async read(config) {
      if (!config?.repo) throw new Error('github.read: config.repo required (owner/name)');
      const check = validateAllowlist('github', config.repo, config);
      if (!check.allowed) throw outOfScopeError(check.reason);
      return ghFetch(`/repos/${config.repo}`, env);
    },

    async search(config) {
      const kind = config?.kind || 'issues';
      const query = config?.query;
      if (!query) throw new Error('github.search: config.query required');

      const hasAllowlistConfig = (Array.isArray(config?.repoAllowlist) && config.repoAllowlist.length > 0)
        || (typeof config?.repoAllowGlob === 'string' && config.repoAllowGlob.length > 0);
      const repoQualifiers = [...query.matchAll(/\brepo:(\S+)/g)].map((m) => m[1]);

      if (hasAllowlistConfig && repoQualifiers.length === 0) {
        throw outOfScopeError('github.search: repoAllowlist/repoAllowGlob is configured; query must include a repo: qualifier to enforce scope');
      }
      for (const repo of repoQualifiers) {
        const target = repo.includes('/') ? repo.split('/').pop() : repo;
        const check = validateAllowlist('github', target, config);
        if (!check.allowed) throw outOfScopeError(check.reason);
      }

      const path = kind === 'code'
        ? `/search/code?q=${encodeURIComponent(query)}`
        : kind === 'prs'
          ? `/search/issues?q=${encodeURIComponent(query + ' is:pr')}`
          : `/search/issues?q=${encodeURIComponent(query + ' is:issue')}`;
      const data = await ghFetch(path, env);
      return Array.isArray(data?.items) ? data.items : [];
    },

    async webhook(config, request) {
      const secret = config?.webhookSecret;
      if (!secret) {
        return { ok: false, error: 'webhookSecret not configured' };
      }
      const signature = request?.headers?.['x-hub-signature-256'];
      if (!signature || !signature.startsWith('sha256=')) {
        return { ok: false, error: 'missing or malformed signature header' };
      }
      const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(typeof request.body === 'string' ? request.body : Buffer.from(request.body))
        .digest('hex');
      const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) return { ok: false, error: 'signature mismatch' };
      return {
        ok: true,
        event: request?.headers?.['x-github-event'] || 'unknown',
        delivery: request?.headers?.['x-github-delivery'] || null,
      };
    },
  };
}

export default create;
