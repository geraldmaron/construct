/**
 * providers/github/index.mjs — GitHub provider.
 *
 * Transport: gh CLI (must be installed and authenticated).
 *
 * Capabilities: read, write, search, webhook
 *
 * read refs:
 *   "prs"                     → open pull requests
 *   "prs:all"                 → all PRs (open + closed)
 *   "pr:<number>"             → single PR detail
 *   "issues"                  → open issues
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
 * search: gh search issues/prs/code
 *   { scope: 'issues'|'prs'|'code', q: 'query string' }
 *
 * webhook: process GitHub webhook event objects
 */

import { spawnSync } from 'node:child_process';
import { AuthError, NotFoundError } from '../lib/errors.mjs';

function gh(args, { json = true, input } = {}) {
  const fullArgs = json ? [...args, '--json', ...ghJsonFields(args)] : args;
  const result = spawnSync('gh', fullArgs, {
    encoding: 'utf8',
    input,
    env: process.env,
  });
  if (result.error) throw new Error(`gh spawn error: ${result.error.message}`);
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || `gh exited with status ${result.status}`;
    if (msg.includes('authentication') || msg.includes('401')) {
      throw new AuthError(msg, { provider: 'github' });
    }
    throw new Error(`gh error: ${msg}`);
  }
  if (json && result.stdout) {
    try { return JSON.parse(result.stdout); } catch { return result.stdout; }
  }
  return result.stdout;
}

// gh requires --json to list specific fields; default to a safe broad set
function ghJsonFields(args) {
  const cmd = args[0];
  if (cmd === 'pr') return ['number,title,state,url,body,headRefName,baseRefName,author,createdAt,mergeable,labels'];
  if (cmd === 'issue') return ['number,title,state,url,body,author,createdAt,labels,assignees'];
  if (cmd === 'release') return ['tagName,name,publishedAt,url,body'];
  if (cmd === 'repo') return ['name,description,url,defaultBranchRef,isPrivate,stargazerCount'];
  return [''];
}

export default {
  name: 'github',
  capabilities: ['read', 'write', 'search', 'webhook'],

  _repo: null,

  async init(config = {}) {
    this._repo = config.repo ?? null; // optional "owner/repo" override
    // Verify gh is available and authenticated
    const check = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', env: process.env });
    if (check.status !== 0) {
      throw new AuthError('gh CLI not authenticated. Run: gh auth login', { provider: 'github' });
    }
  },

  async read(ref, _opts = {}) {
    const repoFlag = this._repo ? ['-R', this._repo] : [];

    if (ref === 'prs' || ref === 'prs:all') {
      const stateFlag = ref === 'prs:all' ? ['--state', 'all'] : ['--state', 'open'];
      return gh(['pr', 'list', ...repoFlag, ...stateFlag, '--limit', '50']);
    }

    if (ref.startsWith('pr:')) {
      const num = ref.slice(3);
      return [gh(['pr', 'view', num, ...repoFlag])];
    }

    if (ref === 'issues') {
      return gh(['issue', 'list', ...repoFlag, '--state', 'open', '--limit', '50']);
    }

    if (ref.startsWith('issue:')) {
      const num = ref.slice(6);
      return [gh(['issue', 'view', num, ...repoFlag])];
    }

    if (ref === 'releases') {
      return gh(['release', 'list', ...repoFlag, '--limit', '20']);
    }

    if (ref === 'repo') {
      return [gh(['repo', 'view', ...repoFlag])];
    }

    throw new NotFoundError(`Unknown GitHub read ref: "${ref}"`, { provider: 'github' });
  },

  async write(item) {
    const repoFlag = this._repo ? ['-R', this._repo] : [];

    if (item.type === 'issue') {
      const args = ['issue', 'create', ...repoFlag, '--title', item.title, '--body', item.body ?? ''];
      if (item.labels?.length) args.push('--label', item.labels.join(','));
      const out = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
      return { type: 'issue-created', url: out.stdout.trim() };
    }

    if (item.type === 'pr') {
      const args = ['pr', 'create', ...repoFlag,
        '--title', item.title,
        '--body', item.body ?? '',
        '--head', item.head,
        '--base', item.base ?? 'main',
      ];
      if (item.draft) args.push('--draft');
      const out = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
      return { type: 'pr-created', url: out.stdout.trim() };
    }

    if (item.type === 'comment') {
      const args = ['issue', 'comment', String(item.issue_number), ...repoFlag, '--body', item.body];
      spawnSync('gh', args, { encoding: 'utf8', env: process.env });
      return { type: 'comment-created', issue_number: item.issue_number };
    }

    if (item.type === 'pr-merge') {
      const method = item.merge_method ?? 'squash';
      spawnSync('gh', ['pr', 'merge', String(item.number), ...repoFlag, `--${method}`], {
        encoding: 'utf8',
        env: process.env,
      });
      return { type: 'pr-merged', number: item.number };
    }

    throw new Error(`Unknown GitHub write item type: "${item.type}"`);
  },

  async search(query, opts = {}) {
    const scope = opts.scope ?? 'issues';
    const repoFlag = this._repo ? ['--repo', this._repo] : [];
    const args = ['search', scope, query, ...repoFlag, '--limit', '30', '--json',
      scope === 'code' ? 'path,repository,url,textMatches' : 'number,title,state,url,repository',
    ];
    const results = gh(args, { json: false });
    try { return JSON.parse(results); } catch { return []; }
  },

  async webhook(event) {
    // Normalize inbound GitHub webhook event to a common shape for core to consume
    const type = event?.action ? `${event.type ?? 'unknown'}.${event.action}` : (event?.type ?? 'unknown');
    return { provider: 'github', type, raw: event };
  },
};
