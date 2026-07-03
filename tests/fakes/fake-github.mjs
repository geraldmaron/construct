/**
 * tests/fakes/fake-github.mjs — in-memory fake GitHub provider.
 *
 * Satisfies the provider contract (lib/providers/contract.mjs) so it can be
 * validated by assertProviderContract at test time. Never makes real network
 * calls. All state is held in the closure returned by create().
 *
 * Usage:
 *   import { FakeGitHub } from './index.mjs';
 *   const fake = FakeGitHub.create();
 *
 *   // Happy path
 *   const issue = await fake.createIssue('owner', 'repo', { title: 'Bug', body: 'details' });
 *
 *   // Failure modes
 *   fake.setMode('secondary-rate-limit');
 *   // fake.setMode('duplicate');
 *
 *   // Inspection / reset
 *   fake.getCreatedIssues();
 *   fake.reset();
 *
 * Implements the provider write() contract shape expected by the registry:
 *   write(config, payload) => result
 * where payload = { type: 'issue', owner, repo, title, body, labels? }
 *
 * The ergonomic createIssue() helper is a thin wrapper used directly in tests.
 */

let _seq = 1;

function nextId() {
  return _seq++;
}

/**
 * Create a FakeGitHub provider instance conforming to the registry contract.
 * Returns the provider object (as returned by a real create() factory) plus
 * test-helper methods (setMode, reset, getCreatedIssues, createIssue).
 */
export function create() {
  /** @type {Array<{id: number, number: number, url: string, title: string, owner: string, repo: string, labels: string[]}>} */
  const _issues = [];
  let _mode = 'normal'; // 'normal' | 'secondary-rate-limit' | 'duplicate'

  // ── private helpers ──────────────────────────────────────────────────────

  function _buildIssue(owner, repo, { title, body = '', labels = [] }) {
    const id = nextId();
    const number = _issues.filter((i) => i.owner === owner && i.repo === repo).length + 1;
    return {
      id,
      number,
      url: `https://github.com/${owner}/${repo}/issues/${number}`,
      title,
      body,
      labels,
      owner,
      repo,
    };
  }

  // ── public test-helper API ────────────────────────────────────────────────

  /**
   * Set the active failure mode.
   * @param {'normal'|'secondary-rate-limit'|'duplicate'} mode
   */
  function setMode(mode) {
    const valid = ['normal', 'secondary-rate-limit', 'duplicate'];
    if (!valid.includes(mode)) {
      throw new Error(`FakeGitHub: unknown mode '${mode}'. Valid: ${valid.join(', ')}`);
    }
    _mode = mode;
  }

  /** Reset all state (created issues + mode). */
  function reset() {
    _issues.length = 0;
    _mode = 'normal';
  }

  /** Return a copy of all issues created so far (across all repos). */
  function getCreatedIssues() {
    return _issues.map((i) => ({ ...i }));
  }

  /**
   * Ergonomic helper for tests — avoids constructing the write() payload shape.
   * @param {string} owner
   * @param {string} repo
   * @param {{ title: string, body?: string, labels?: string[] }} opts
   * @returns {{ id: number, number: number, url: string }}
   */
  async function createIssue(owner, repo, { title, body = '', labels = [] } = {}) {
    if (_mode === 'secondary-rate-limit') {
      const err = new Error('secondary rate limit');
      err.status = 403;
      throw err;
    }

    if (_mode === 'duplicate') {
      const existing = _issues.find(
        (i) => i.owner === owner && i.repo === repo && i.title === title,
      );
      if (existing) {
        return { id: existing.id, number: existing.number, url: existing.url };
      }
    }

    const issue = _buildIssue(owner, repo, { title, body, labels });
    _issues.push(issue);
    return { id: issue.id, number: issue.number, url: issue.url };
  }

  // ── provider contract implementation ─────────────────────────────────────
  // write() maps the registry payload shape to createIssue/createPR/etc.

  async function write(_config, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('FakeGitHub.write: payload must be an object');
    }
    if (payload.type === 'issue') {
      const { owner = 'test-owner', repo = 'test-repo', title, body, labels } = payload;
      return createIssue(owner, repo, { title, body, labels });
    }
    throw new Error(`FakeGitHub.write: unknown type '${payload.type}'`);
  }

  async function read(_config, _query) {
    // Minimal implementation to satisfy the 'read' capability declaration.
    return [];
  }

  async function search(_config, _query) {
    const query = typeof _query === 'string' ? _query : (_query?.query ?? '');
    return _issues
      .filter((i) => !query || i.title.toLowerCase().includes(query.toLowerCase()))
      .map((i) => ({ ...i }));
  }

  async function webhook(_config, _request) {
    return { ok: true };
  }

  async function health() {
    return { ok: true, detail: 'fake-github: always healthy' };
  }

  return Object.assign(
    {
      meta: {
        id: 'fake-github',
        displayName: 'Fake GitHub',
        capabilities: ['read', 'search', 'write', 'webhook'],
        description: 'In-memory fake GitHub provider for tests. No real network calls.',
      },
      health,
      read,
      search,
      write,
      webhook,
    },
    // test-helper surface
    { setMode, reset, getCreatedIssues, createIssue },
  );
}

export default create;
