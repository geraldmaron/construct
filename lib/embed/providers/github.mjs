/**
 * lib/embed/providers/github.mjs — GitHub provider for embed mode.
 *
 * Reads PRs, issues, and commits from one or more repositories using the
 * GitHub REST API. Zero external deps — uses Node's built-in fetch.
 *
 * Supported refs:
 *   prs        Open pull requests
 *   issues     Open issues (excludes PRs)
 *   commits    Recent commits on the default branch
 *
 * Source config fields (embed.yaml):
 *   provider: github
 *   repo: owner/name           # single repo
 *   repos:                     # OR list of repos
 *     - owner/name
 *     - owner/name2
 *   refs: [prs, issues]
 *   branch: main               # for commits ref (default: repo default branch)
 *   limit: 25                  # max items per ref per repo (default: 25)
 */

const GITHUB_API = 'https://api.github.com';

export class GitHubProvider {
  #token;
  #fetchFn;

  constructor({ token, fetchFn = globalThis.fetch } = {}) {
    if (!token) throw new Error('GitHubProvider requires a token');
    this.#token = token;
    this.#fetchFn = fetchFn;
  }

  /**
   * Default sources used when no embed.yaml is present.
   * GitHub requires a repo — without one we can't auto-discover, so return empty.
   * Users can still add a repo via config.env GITHUB_REPOS=owner/repo,owner/repo2.
   */
  defaultSources(env = {}) {
    const raw = env.GITHUB_REPOS ?? env.GITHUB_REPO ?? '';
    const repos = raw.split(',').map((r) => r.trim()).filter(Boolean);
    if (!repos.length) return [];
    return [
      {
        provider: 'github',
        repos,
        refs: ['prs', 'issues'],
        limit: 25,
      },
    ];
  }

  /**
   * @param {string} ref      - 'prs' | 'issues' | 'commits'
   * @param {object} opts     - source config (repo, repos, branch, limit)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    const repos = resolveRepos(opts);
    if (!repos.length) {
      throw new Error(`GitHub source requires "repo" or "repos" field`);
    }

    const limit = Number(opts.limit ?? 25);
    const results = [];

    for (const repo of repos) {
      try {
        const items = await this.#readRepo(ref, repo, { branch: opts.branch, limit });
        results.push(...items);
      } catch (err) {
        // Surface per-repo errors as items so the snapshot shows them
        results.push({
          type: 'error',
          source: 'github',
          repo,
          ref,
          message: err.message,
        });
      }
    }

    return results;
  }

  async #readRepo(ref, repo, { branch, limit }) {
    switch (ref) {
      case 'prs':      return this.#listPRs(repo, limit);
      case 'issues':   return this.#listIssues(repo, limit);
      case 'commits':  return this.#listCommits(repo, { branch, limit });
      default:         throw new Error(`GitHub provider: unknown ref "${ref}"`);
    }
  }

  async #listPRs(repo, limit) {
    const data = await this.#get(`/repos/${repo}/pulls?state=open&per_page=${limit}&sort=updated&direction=desc`);
    return data.map((pr) => ({
      type: 'pr',
      source: 'github',
      repo,
      number: pr.number,
      title: pr.title,
      author: pr.user?.login,
      state: pr.state,
      draft: pr.draft ?? false,
      url: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      labels: (pr.labels ?? []).map((l) => l.name),
      reviewers: (pr.requested_reviewers ?? []).map((r) => r.login),
      summary: `PR #${pr.number}: ${pr.title}`,
    }));
  }

  async #listIssues(repo, limit) {
    // GitHub issues endpoint returns PRs too — filter them out
    const data = await this.#get(`/repos/${repo}/issues?state=open&per_page=${limit}&sort=updated&direction=desc`);
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        type: 'issue',
        source: 'github',
        repo,
        number: issue.number,
        title: issue.title,
        author: issue.user?.login,
        state: issue.state,
        url: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        labels: (issue.labels ?? []).map((l) => l.name),
        summary: `Issue #${issue.number}: ${issue.title}`,
      }));
  }

  async #listCommits(repo, { branch, limit }) {
    const branchParam = branch ? `&sha=${encodeURIComponent(branch)}` : '';
    const data = await this.#get(`/repos/${repo}/commits?per_page=${limit}${branchParam}`);
    return data.map((c) => ({
      type: 'commit',
      source: 'github',
      repo,
      hash: c.sha,
      subject: c.commit?.message?.split('\n')[0] ?? '',
      author: c.commit?.author?.name ?? c.author?.login ?? 'unknown',
      date: c.commit?.author?.date,
      url: c.html_url,
      summary: `${c.sha.slice(0, 7)} ${c.commit?.message?.split('\n')[0] ?? ''}`,
    }));
  }

  async #get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.#fetchFn(`${GITHUB_API}${path}`, {
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveRepos(opts) {
  if (Array.isArray(opts.repos)) return opts.repos.filter(Boolean);
  if (opts.repo) return [opts.repo];
  return [];
}
