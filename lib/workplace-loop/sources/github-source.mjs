/**
 * lib/workplace-loop/sources/github-source.mjs — real GitHub signal source,
 * replacing spike D's fixture with a real
 * D1s-retained provider adapter). Reuses lib/providers/github/index.mjs's
 * data-source provider (`search()`, GitHub REST search API, read-only) — the
 * same retained D1s adapter framework target-model.md's Source concept
 * (§2, "does not build new provider adapters from scratch") names, not a
 * hand-rolled HTTP client. This module only reads; it never writes — writes
 * are a separate, explicitly-gated concern (lib/workplace-loop/gate.mjs)
 * routed through the M2 chokepoint, never through this source directly.
 *
 * `repo` defaults to the local checkout's own `git remote get-url origin`
 * (normalized to "owner/repo"), so a project dogfoods its own real issue
 * tracker without hardcoding a repo name — this is what "at least one real
 * connected source" (the bead's acceptance criteria) means in practice: the
 * project's own GitHub repo, not a synthetic stand-in.
 */

import { execFileSync } from 'node:child_process';

import { create as createGithubReadProvider } from '../../providers/github/index.mjs';

/**
 * Parse "owner/repo" out of a git remote URL in either scp-like
 * (`git@github.com:owner/repo.git`) or https (`https://github.com/owner/repo.git`)
 * form. Returns null for anything else (e.g. a non-GitHub remote) — the
 * caller degrades to "no source configured" rather than guessing.
 */
export function parseOwnerRepoFromRemote(url) {
  if (!url) return null;
  const scp = /^[^@/]+@[^:]+:([^/]+)\/(.+?)(\.git)?$/.exec(url.trim());
  if (scp) return `${scp[1]}/${scp[2]}`;
  const https = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+\/([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(url.trim());
  if (https) return `${https[1]}/${https[2]}`;
  return null;
}

/**
 * Resolve the default GitHub `owner/repo` for a project from its git origin
 * remote. Returns null (never throws) when there is no remote, no git repo,
 * or a non-GitHub remote — every caller must treat null as "no real source
 * configured for this project" rather than a fabricated fallback.
 */
export function resolveDefaultGithubRepo(rootDir) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString().trim();
    return parseOwnerRepoFromRemote(url);
  } catch {
    return null;
  }
}

/**
 * Fetch open issues for `repo` and normalize into the loop's generic signal
 * input shape: `{ id, title, body, state, labels, assignee, updatedAt,
 * createdAt, url, source: {kind: 'github', repo, ref} }`. `providerFactory`
 * is injectable so tests exercise this module's normalization logic without
 * a real network call — the real default hits GitHub's public search API
 * read-only, unauthenticated unless GITHUB_TOKEN/GH_TOKEN is set in `env`.
 *
 * @param {object} opts
 * @param {string} opts.repo - "owner/name"; throws if absent (no fabricated repo)
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {(opts: {env: NodeJS.ProcessEnv}) => {search: Function}} [opts.providerFactory]
 * @returns {Promise<{repo: string, fetchedAt: string, issues: object[]}>}
 */
export async function fetchGithubOpenIssues({
  repo,
  env = process.env,
  providerFactory = createGithubReadProvider,
} = {}) {
  if (!repo) {
    throw new Error('fetchGithubOpenIssues: repo ("owner/name") is required — no fabricated default');
  }
  const provider = providerFactory({ env });
  const rawIssues = await provider.search({ kind: 'issues', query: `repo:${repo} is:issue is:open` });
  const fetchedAt = new Date().toISOString();

  const issues = rawIssues
    .filter((raw) => !raw.pull_request)
    .map((raw) => ({
      id: `GH-${raw.number}`,
      title: raw.title ?? '',
      body: raw.body ?? '',
      state: raw.state ?? 'open',
      labels: (raw.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
      assignee: raw.assignee?.login ?? (raw.assignees?.[0]?.login ?? null),
      updatedAt: raw.updated_at ?? null,
      createdAt: raw.created_at ?? null,
      url: raw.html_url ?? null,
      source: { kind: 'github', repo, ref: `#${raw.number}` },
    }));

  return { repo, fetchedAt, issues };
}
