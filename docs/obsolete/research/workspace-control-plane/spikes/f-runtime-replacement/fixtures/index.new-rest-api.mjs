/**
 * providers/github/index.mjs — GitHub provider.
 *
 * Transport: GitHub REST API v3 over HTTPS (built-in fetch), token auth via
 * GITHUB_TOKEN/GH_TOKEN env or config.token. No external binary dependency.
 * Repo scoping requires an explicit owner/repo: config.repo, or
 * GITHUB_REPOSITORY, or a best-effort inference from the git origin remote
 * (see inferRepoFromGit()).
 *
 * Capabilities: read, write, search, webhook
 *
 * read refs:
 *   "prs"                     → open pull requests
 *   "prs:all"                 → all PRs (open + closed)
 *   "pr:<number>"             → single PR detail
 *   "issues"                  → open issues (PRs excluded, matches `gh issue list`)
 *   "issue:<number>"          → single issue detail
 *   "releases"                → recent releases
 *   "repo"                    → repo metadata
 *
 * write items:
 *   { type: 'pr', title, body, head, base }            → create PR
 *   { type: 'issue', title, body, labels? }            → create issue
 *   { type: 'comment', issue_number, body }            → comment on issue/PR
 *   { type: 'pr-merge', number, merge_method? }        → merge a PR
 *
 * search: GitHub search API (issues/prs share the /search/issues endpoint;
 * code uses /search/code)
 *   { scope: 'issues'|'prs'|'code', q: 'query string' }
 *
 * webhook: process GitHub webhook event objects
 */

import { execFileSync } from 'node:child_process';
import { AuthError, NotFoundError, RateLimitError } from '../../errors.mjs';

const DEFAULT_API_BASE = 'https://api.github.com';

// The REST API returns a real `Retry-After` header (seconds) on both primary
// (403 unauthenticated abuse) and secondary (403 "you have exceeded a
// secondary rate limit") throttling, read directly off the response header.
const SECONDARY_RATE_LIMIT_DEFAULT_RETRY_AFTER = 60;

function parseRetryAfterSeconds(headers) {
  const raw = headers?.get?.('retry-after');
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : SECONDARY_RATE_LIMIT_DEFAULT_RETRY_AFTER;
}

// A REST call needs an explicit owner/repo; this is the only implicit-context
// fallback, derived from `git remote get-url origin`. It covers a plain
// origin remote only — not GH_REPO, gh config, or upstream tracking branches
// — so callers that depend on those cases must pass config.repo explicitly.
function inferRepoFromGit(cwd = process.cwd()) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString().trim();
    const scp = /^[^@/]+@[^:]+:(.+?)(?:\.git)?$/.exec(url);
    const https = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
    const match = scp || https;
    return match ? match[1].replace(/\.git$/, '') : null;
  } catch {
    return null;
  }
}

async function githubRequest({ method = 'GET', path, apiBase, token, body }) {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    throw new AuthError('GitHub REST API returned 401 (bad or missing token). Set GITHUB_TOKEN or GH_TOKEN.', { provider: 'github' });
  }
  if (res.status === 403) {
    const text = await res.text().catch(() => '');
    if (/rate limit/i.test(text)) {
      throw new RateLimitError(text.trim() || 'rate limited', {
        provider: 'github',
        retryAfter: parseRetryAfterSeconds(res.headers),
      });
    }
    throw new AuthError(`GitHub REST API returned 403: ${text.trim() || '(no body)'}`, { provider: 'github' });
  }
  if (res.status === 404) {
    throw new NotFoundError(`GitHub REST API 404 for ${method} ${path}`, { provider: 'github' });
  }
  if (res.status === 429) {
    const text = await res.text().catch(() => '');
    throw new RateLimitError(text.trim() || 'rate limited', {
      provider: 'github',
      retryAfter: parseRetryAfterSeconds(res.headers),
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub REST API ${res.status} for ${method} ${path}: ${text.trim() || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export default {
  name: 'github',
  capabilities: ['read', 'write', 'search', 'webhook'],

  _repo: null,
  _token: null,
  _apiBase: DEFAULT_API_BASE,

  async init(config = {}) {
    this._repo = config.repo ?? process.env.GITHUB_REPOSITORY ?? inferRepoFromGit(config.cwd) ?? null;
    this._token = config.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    this._apiBase = config.apiBase ?? DEFAULT_API_BASE;

    if (!this._token) {
      throw new AuthError('No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN.', { provider: 'github' });
    }
    // Confirm the token authenticates before any capability call runs.
    await githubRequest({ path: '/user', apiBase: this._apiBase, token: this._token });
  },

  _requireRepo() {
    if (!this._repo) {
      throw new Error('github provider: no repo configured (config.repo, GITHUB_REPOSITORY, or a resolvable git origin remote is required)');
    }
    return this._repo;
  },

  async read(ref, _opts = {}) {
    const repo = this._requireRepo();

    if (ref === 'prs' || ref === 'prs:all') {
      const state = ref === 'prs:all' ? 'all' : 'open';
      return githubRequest({ path: `/repos/${repo}/pulls?state=${state}&per_page=50`, apiBase: this._apiBase, token: this._token });
    }

    if (ref.startsWith('pr:')) {
      const num = ref.slice(3);
      return [await githubRequest({ path: `/repos/${repo}/pulls/${num}`, apiBase: this._apiBase, token: this._token })];
    }

    if (ref === 'issues') {
      const items = await githubRequest({ path: `/repos/${repo}/issues?state=open&per_page=50`, apiBase: this._apiBase, token: this._token });
      // The issues endpoint also returns PRs; `gh issue list` excludes them.
      return (items || []).filter((i) => !i.pull_request);
    }

    if (ref.startsWith('issue:')) {
      const num = ref.slice(6);
      return [await githubRequest({ path: `/repos/${repo}/issues/${num}`, apiBase: this._apiBase, token: this._token })];
    }

    if (ref === 'releases') {
      return githubRequest({ path: `/repos/${repo}/releases?per_page=20`, apiBase: this._apiBase, token: this._token });
    }

    if (ref === 'repo') {
      return [await githubRequest({ path: `/repos/${repo}`, apiBase: this._apiBase, token: this._token })];
    }

    throw new NotFoundError(`Unknown GitHub read ref: "${ref}"`, { provider: 'github' });
  },

  async write(item) {
    if (!['issue', 'pr', 'comment', 'pr-merge'].includes(item.type)) {
      throw new Error(`Unknown GitHub write item type: "${item.type}"`);
    }
    const repo = this._requireRepo();

    if (item.type === 'issue') {
      const created = await githubRequest({
        method: 'POST',
        path: `/repos/${repo}/issues`,
        apiBase: this._apiBase,
        token: this._token,
        body: { title: item.title, body: item.body ?? '', labels: item.labels?.length ? item.labels : undefined },
      });
      return { type: 'issue-created', url: created.html_url };
    }

    if (item.type === 'pr') {
      const created = await githubRequest({
        method: 'POST',
        path: `/repos/${repo}/pulls`,
        apiBase: this._apiBase,
        token: this._token,
        body: { title: item.title, body: item.body ?? '', head: item.head, base: item.base ?? 'main', draft: !!item.draft },
      });
      return { type: 'pr-created', url: created.html_url };
    }

    if (item.type === 'comment') {
      const created = await githubRequest({
        method: 'POST',
        path: `/repos/${repo}/issues/${item.issue_number}/comments`,
        apiBase: this._apiBase,
        token: this._token,
        body: { body: item.body },
      });
      return { type: 'comment-created', issue_number: item.issue_number, url: created.html_url };
    }

    if (item.type === 'pr-merge') {
      const method = item.merge_method ?? 'squash';
      await githubRequest({
        method: 'PUT',
        path: `/repos/${repo}/pulls/${item.number}/merge`,
        apiBase: this._apiBase,
        token: this._token,
        body: { merge_method: method },
      });
      return { type: 'pr-merged', number: item.number };
    }
  },

  async search(query, opts = {}) {
    const scope = opts.scope ?? 'issues';
    const repo = this._repo;
    const qualifiedQuery = repo ? `${query} repo:${repo}` : query;
    const endpoint = scope === 'code' ? '/search/code' : '/search/issues';
    const result = await githubRequest({
      path: `${endpoint}?q=${encodeURIComponent(qualifiedQuery)}&per_page=30`,
      apiBase: this._apiBase,
      token: this._token,
    });
    return result?.items ?? [];
  },

  async webhook(event) {
    // Normalize inbound GitHub webhook event to a common shape for core to consume
    const type = event?.action ? `${event.type ?? 'unknown'}.${event.action}` : (event?.type ?? 'unknown');
    return { provider: 'github', type, raw: event };
  },
};
