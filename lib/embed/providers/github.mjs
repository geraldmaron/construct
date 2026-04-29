/**
 * lib/embed/providers/github.mjs — GitHub provider for embed mode.
 *
 * Reads PRs, issues, commits, repo metadata, README, and top-level docs from
 * one or more repositories using the GitHub REST API. Zero external deps —
 * uses Node's built-in fetch.
 *
 * Supported refs:
 *   prs        Open pull requests
 *   issues     Open issues (excludes PRs)
 *   commits    Recent commits on the default branch
 *   meta       Repo metadata (name, description, topics, language, visibility)
 *   readme     README file content (decoded from base64)
 *   docs       Markdown files in repo root and /docs directory
 */

const GITHUB_API = 'https://api.github.com';

// Max chars to store per doc file — keeps observations scannable
const DOC_CONTENT_LIMIT = 8_000;

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
   * Returns one source per enrichment group:
   *   - activity:  prs + issues + commits (live work)
   *   - context:   meta + readme + docs   (repo understanding)
   */
  defaultSources(env = {}) {
    const raw = env.GITHUB_REPOS ?? env.GITHUB_REPO ?? '';
    const repos = raw.split(',').map((r) => r.trim()).filter(Boolean);
    if (!repos.length) return [];
    return [
      {
        provider: 'github',
        repos,
        refs: ['prs', 'issues', 'commits'],
        limit: 25,
      },
      {
        provider: 'github',
        repos,
        refs: ['meta', 'readme', 'docs'],
        limit: 25,
      },
    ];
  }

  /**
   * @param {string} ref      - 'prs' | 'issues' | 'commits' | 'meta' | 'readme' | 'docs'
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
      case 'meta':     return this.#fetchMeta(repo);
      case 'readme':   return this.#fetchReadme(repo);
      case 'docs':     return this.#fetchDocs(repo);
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

  async #fetchMeta(repo) {
    const data = await this.#get(`/repos/${repo}`);
    return [{
      type: 'meta',
      source: 'github',
      repo,
      name: data.name,
      fullName: data.full_name,
      description: data.description ?? '',
      topics: data.topics ?? [],
      language: data.language ?? null,
      visibility: data.visibility ?? (data.private ? 'private' : 'public'),
      defaultBranch: data.default_branch ?? 'main',
      url: data.html_url,
      pushedAt: data.pushed_at,
      summary: `Repo ${data.full_name}: ${data.description ?? 'no description'}`,
    }];
  }

  async #fetchReadme(repo) {
    let data;
    try {
      data = await this.#get(`/repos/${repo}/readme`);
    } catch (err) {
      // 404 = no README — not an error worth surfacing
      if (err.message.includes('404')) return [];
      throw err;
    }
    const content = decodeBase64(data.content ?? '').slice(0, DOC_CONTENT_LIMIT);
    return [{
      type: 'doc',
      source: 'github',
      repo,
      path: data.path ?? 'README.md',
      url: data.html_url ?? `https://github.com/${repo}/blob/HEAD/${data.path ?? 'README.md'}`,
      content,
      summary: `README for ${repo}`,
    }];
  }

  async #fetchDocs(repo) {
    const results = [];

    // Collect .md files from repo root and /docs, in parallel
    const [rootTree, docsTree] = await Promise.all([
      this.#getTree(repo, ''),
      this.#getTree(repo, 'docs'),
    ]);

    const mdFiles = [
      ...rootTree.filter((f) => f.type === 'file' && /\.md$/i.test(f.path) && !isReadme(f.path)),
      ...docsTree.filter((f) => f.type === 'file' && /\.md$/i.test(f.path)),
    ];

    // Fetch files concurrently (cap at 10 to stay well under rate limits)
    const batch = mdFiles.slice(0, 10);
    const fetched = await Promise.allSettled(
      batch.map((f) => this.#fetchFile(repo, f.path))
    );

    for (let i = 0; i < fetched.length; i++) {
      const r = fetched[i];
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }

    return results;
  }

  async #getTree(repo, dir) {
    try {
      const path = dir ? `/repos/${repo}/contents/${dir}` : `/repos/${repo}/contents`;
      const data = await this.#get(path);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async #fetchFile(repo, path) {
    try {
      const data = await this.#get(`/repos/${repo}/contents/${path}`);
      if (data.encoding !== 'base64' || !data.content) return null;
      const content = decodeBase64(data.content).slice(0, DOC_CONTENT_LIMIT);
      return {
        type: 'doc',
        source: 'github',
        repo,
        path,
        url: data.html_url ?? `https://github.com/${repo}/blob/HEAD/${path}`,
        content,
        summary: `Doc ${path} in ${repo}`,
      };
    } catch {
      return null;
    }
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

function decodeBase64(str) {
  // GitHub base64 includes newlines — strip them first
  return Buffer.from(str.replace(/\s/g, ''), 'base64').toString('utf8');
}

function isReadme(path) {
  return /^readme(\.\w+)?$/i.test(path);
}
