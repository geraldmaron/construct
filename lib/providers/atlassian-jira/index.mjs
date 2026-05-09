/**
 * lib/providers/atlassian-jira/index.mjs — Jira data-source provider.
 *
 * Capabilities: read, search.
 *
 * Auth: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` from env.
 *
 * Config (per call):
 *   - issueKey: 'PROJ-123' for read
 *   - jql:      JQL string for search (e.g. 'project = RLBLT AND assignee = currentUser()')
 *   - maxResults: integer (default 50, max 100)
 */

const DEFAULT_MAX = 50;
const HARD_MAX = 100;

function authConfig(env) {
  const baseUrl = env.JIRA_BASE_URL?.replace(/\/$/, '') || '';
  const email = env.JIRA_EMAIL || '';
  const token = env.JIRA_API_TOKEN || '';
  return { baseUrl, email, token, ok: Boolean(baseUrl && email && token) };
}

function authHeader({ email, token }) {
  if (!email || !token) return {};
  const basic = Buffer.from(`${email}:${token}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

async function jiraFetch(path, env, init = {}) {
  const auth = authConfig(env);
  if (!auth.ok) throw new Error('jira: JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN must be set');
  const url = `${auth.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...authHeader(auth),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'atlassian-jira',
      displayName: 'Atlassian Jira',
      capabilities: ['read', 'search'],
      description: 'Issues, sprints, JQL search.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        issueKey: { type: 'string', pattern: '^[A-Z][A-Z0-9_]+-[0-9]+$' },
        jql: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: HARD_MAX, default: DEFAULT_MAX },
      },
    },

    async health() {
      const auth = authConfig(env);
      if (!auth.ok) {
        return { ok: false, detail: 'JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN not set' };
      }
      try {
        await jiraFetch('/rest/api/3/myself', env);
        return { ok: true, detail: `connected to ${auth.baseUrl}` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    async read(config) {
      if (!config?.issueKey) throw new Error('jira.read: config.issueKey required');
      return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(config.issueKey)}`, env);
    },

    async search(config) {
      const jql = config?.jql;
      if (!jql) throw new Error('jira.search: config.jql required');
      const max = Math.min(config?.maxResults || DEFAULT_MAX, HARD_MAX);
      const data = await jiraFetch('/rest/api/3/search', env, {
        method: 'POST',
        body: JSON.stringify({ jql, maxResults: max, fields: ['summary', 'status', 'assignee', 'priority', 'updated'] }),
      });
      return Array.isArray(data?.issues) ? data.issues : [];
    },
  };
}

export default create;
