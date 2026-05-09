/**
 * providers/jira/index.mjs — Jira provider.
 *
 * Transport: Jira REST API v3 (direct fetch, no SDK).
 * Auth: API token via JIRA_TOKEN + JIRA_EMAIL + JIRA_URL env vars,
 *       or passed directly in config.
 *
 * Capabilities: read, write, search, webhook
 *
 * read refs:
 *   "issue:<KEY>"              → single issue (e.g. "issue:PROJ-123")
 *   "project:<KEY>"            → project metadata
 *   "board:<id>:sprint"        → active sprint issues for a board
 *   "search:<JQL>"             → JQL query (shorthand; prefer search() for full control)
 *
 * write items:
 *   { type: 'issue', project, issueType, summary, description?, assignee?, labels? }
 *   { type: 'comment', issueKey, body }
 *   { type: 'transition', issueKey, transitionId }
 *   { type: 'update', issueKey, fields }
 *
 * search: JQL string (e.g. "project = PROJ AND status = 'In Progress'")
 *
 * webhook: process Jira webhook event objects
 */

import { AuthError, NotFoundError, RateLimitError } from '../lib/errors.mjs';

export default {
  name: 'jira',
  capabilities: ['read', 'write', 'search', 'webhook'],

  _baseUrl: null,
  _auth: null,

  async init(config = {}) {
    const url = config.baseUrl ?? process.env.JIRA_URL;
    const email = config.email ?? process.env.JIRA_EMAIL;
    const token = config.token ?? process.env.JIRA_TOKEN;

    if (!url || !email || !token) {
      throw new AuthError(
        'Jira provider requires JIRA_URL, JIRA_EMAIL, and JIRA_TOKEN (or config.baseUrl/email/token)',
        { provider: 'jira' },
      );
    }

    this._baseUrl = url.replace(/\/$/, '');
    this._auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

    // Verify credentials
    const res = await this._fetch('/rest/api/3/myself');
    if (!res.ok) {
      throw new AuthError(`Jira auth failed: ${res.status} ${res.statusText}`, { provider: 'jira' });
    }
  },

  async _fetch(path, { method = 'GET', body } = {}) {
    const url = `${this._baseUrl}${path}`;
    const opts = {
      method,
      headers: {
        Authorization: this._auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError('Jira rate limit hit', { provider: 'jira', retryAfter });
    }
    return res;
  },

  async read(ref, _opts = {}) {
    if (ref.startsWith('issue:')) {
      const key = ref.slice(6);
      const res = await this._fetch(`/rest/api/3/issue/${key}`);
      if (res.status === 404) throw new NotFoundError(`Issue not found: ${key}`, { provider: 'jira' });
      const data = await res.json();
      return [normalizeIssue(data)];
    }

    if (ref.startsWith('project:')) {
      const key = ref.slice(8);
      const res = await this._fetch(`/rest/api/3/project/${key}`);
      if (res.status === 404) throw new NotFoundError(`Project not found: ${key}`, { provider: 'jira' });
      return [await res.json()];
    }

    if (ref.startsWith('search:')) {
      const jql = ref.slice(7);
      return this.search(jql);
    }

    throw new NotFoundError(`Unknown Jira read ref: "${ref}"`, { provider: 'jira' });
  },

  async write(item) {
    if (item.type === 'issue') {
      const body = {
        fields: {
          project: { key: item.project },
          issuetype: { name: item.issueType ?? 'Task' },
          summary: item.summary,
          ...(item.description ? { description: adfDoc(item.description) } : {}),
          ...(item.assignee ? { assignee: { accountId: item.assignee } } : {}),
          ...(item.labels ? { labels: item.labels } : {}),
        },
      };
      const res = await this._fetch('/rest/api/3/issue', { method: 'POST', body });
      const data = await res.json();
      return { type: 'issue-created', key: data.key, id: data.id };
    }

    if (item.type === 'comment') {
      const body = { body: adfDoc(item.body) };
      const res = await this._fetch(`/rest/api/3/issue/${item.issueKey}/comment`, { method: 'POST', body });
      const data = await res.json();
      return { type: 'comment-created', id: data.id, issueKey: item.issueKey };
    }

    if (item.type === 'transition') {
      await this._fetch(`/rest/api/3/issue/${item.issueKey}/transitions`, {
        method: 'POST',
        body: { transition: { id: String(item.transitionId) } },
      });
      return { type: 'transitioned', issueKey: item.issueKey, transitionId: item.transitionId };
    }

    if (item.type === 'update') {
      await this._fetch(`/rest/api/3/issue/${item.issueKey}`, {
        method: 'PUT',
        body: { fields: item.fields },
      });
      return { type: 'updated', issueKey: item.issueKey };
    }

    throw new Error(`Unknown Jira write item type: "${item.type}"`);
  },

  async search(query, opts = {}) {
    const body = {
      jql: query,
      maxResults: opts.maxResults ?? 50,
      fields: opts.fields ?? ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated'],
    };
    const res = await this._fetch('/rest/api/3/search', { method: 'POST', body });
    const data = await res.json();
    return (data.issues ?? []).map(normalizeIssue);
  },

  async webhook(event) {
    const type = event?.webhookEvent ?? 'unknown';
    return { provider: 'jira', type, raw: event };
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeIssue(raw) {
  const f = raw.fields ?? {};
  return {
    type: 'issue',
    key: raw.key,
    id: raw.id,
    summary: f.summary,
    status: f.status?.name,
    assignee: f.assignee?.displayName ?? null,
    priority: f.priority?.name ?? null,
    issueType: f.issuetype?.name,
    created: f.created,
    updated: f.updated,
    url: raw.self?.replace(/\/rest\/api\/.*/, `/browse/${raw.key}`) ?? null,
  };
}

/** Wrap plain text in minimal ADF document for Jira REST API v3 */
function adfDoc(text) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text) }] }],
  };
}
