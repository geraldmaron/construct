/**
 * tests/fakes/fake-jira.mjs — in-memory fake Jira provider.
 *
 * Satisfies the provider contract (lib/providers/contract.mjs) so it can be
 * validated by assertProviderContract at test time. Never makes real network
 * calls. All state is held in the closure returned by create().
 *
 * Usage:
 *   import { FakeJira } from './index.mjs';
 *   const fake = FakeJira.create();
 *
 *   // Happy path
 *   const issue = await fake.createIssue('PROJ', { summary: 'Bug', description: '…', issuetype: 'Task' });
 *
 *   // Failure modes
 *   fake.setMode('adf-error');
 *   fake.setMode('permission-denied');
 *
 *   // Inspection / reset
 *   fake.getCreatedIssues();
 *   fake.reset();
 *
 * Implements the provider write() contract shape:
 *   write(config, payload) => result
 * where payload = { type: 'issue', projectKey, summary, description?, issuetype? }
 */

let _seq = 100;

function nextId() {
  return _seq++;
}

function nextKey(projectKey, count) {
  return `${projectKey}-${count + 1}`;
}

/**
 * Create a FakeJira provider instance conforming to the registry contract.
 */
export function create() {
  /** @type {Array<{id: string, key: string, url: string, summary: string, projectKey: string, issuetype: string}>} */
  const _issues = [];
  let _mode = 'normal'; // 'normal' | 'adf-error' | 'permission-denied'

  // ── private helpers ──────────────────────────────────────────────────────

  function _buildIssue(projectKey, { summary, description = '', issuetype = 'Task' }) {
    const id = String(nextId());
    const count = _issues.filter((i) => i.projectKey === projectKey).length;
    const key = nextKey(projectKey, count);
    return {
      id,
      key,
      url: `https://jira.example.com/browse/${key}`,
      summary,
      description,
      issuetype,
      projectKey,
    };
  }

  // ── public test-helper API ────────────────────────────────────────────────

  /**
   * Set the active failure mode.
   * @param {'normal'|'adf-error'|'permission-denied'} mode
   */
  function setMode(mode) {
    const valid = ['normal', 'adf-error', 'permission-denied'];
    if (!valid.includes(mode)) {
      throw new Error(`FakeJira: unknown mode '${mode}'. Valid: ${valid.join(', ')}`);
    }
    _mode = mode;
  }

  /** Reset all state (created issues + mode). */
  function reset() {
    _issues.length = 0;
    _mode = 'normal';
  }

  /** Return a copy of all issues created so far. */
  function getCreatedIssues() {
    return _issues.map((i) => ({ ...i }));
  }

  /**
   * Ergonomic helper for tests.
   * @param {string} projectKey  e.g. 'PROJ'
   * @param {{ summary: string, description?: string, issuetype?: string }} opts
   * @returns {{ id: string, key: string, url: string }}
   */
  async function createIssue(projectKey, { summary, description = '', issuetype = 'Task' } = {}) {
    if (_mode === 'adf-error') {
      const err = new Error('ADF validation failed');
      err.status = 400;
      throw err;
    }

    if (_mode === 'permission-denied') {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    const issue = _buildIssue(projectKey, { summary, description, issuetype });
    _issues.push(issue);
    return { id: issue.id, key: issue.key, url: issue.url };
  }

  // ── provider contract implementation ─────────────────────────────────────

  async function write(_config, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('FakeJira.write: payload must be an object');
    }
    if (payload.type === 'issue') {
      const { projectKey = 'TEST', summary, description, issuetype } = payload;
      return createIssue(projectKey, { summary, description, issuetype });
    }
    throw new Error(`FakeJira.write: unknown type '${payload.type}'`);
  }

  async function read(_config, _query) {
    // Minimal implementation to satisfy the 'read' capability declaration.
    return [];
  }

  async function search(_config, _query) {
    const jql = typeof _query === 'string' ? _query : (_query?.jql ?? '');
    // Very naive JQL simulation: filter by project key if "project = KEY" appears.
    const match = jql.match(/project\s*=\s*["']?([A-Z]+)["']?/i);
    const filtered = match
      ? _issues.filter((i) => i.projectKey === match[1].toUpperCase())
      : _issues;
    return filtered.map((i) => ({ ...i }));
  }

  async function health() {
    return { ok: true, detail: 'fake-jira: always healthy' };
  }

  return Object.assign(
    {
      meta: {
        id: 'fake-jira',
        displayName: 'Fake Jira',
        capabilities: ['read', 'search', 'write'],
        description: 'In-memory fake Jira provider for tests. No real network calls.',
      },
      health,
      read,
      search,
      write,
    },
    // test-helper surface
    { setMode, reset, getCreatedIssues, createIssue },
  );
}

export default create;
