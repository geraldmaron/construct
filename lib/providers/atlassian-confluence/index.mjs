/**
 * lib/providers/atlassian-confluence/index.mjs — Confluence data-source provider.
 *
 * Capabilities: read, search.
 *
 * Auth: shares JIRA_* env vars with the Jira provider (Atlassian Cloud uses
 * the same email + API token across products) plus optional
 * `CONFLUENCE_BASE_URL` if it differs from `JIRA_BASE_URL`.
 *
 * Config (per call):
 *   - pageId:  numeric id of the page to read
 *   - cql:     CQL query string (e.g. 'space = ENG AND text ~ "auth"')
 *   - limit:   integer (default 25)
 */

const DEFAULT_LIMIT = 25;
const HARD_LIMIT = 100;

function authConfig(env) {
  const baseUrl = (env.CONFLUENCE_BASE_URL || env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const email = env.CONFLUENCE_EMAIL || env.JIRA_EMAIL || '';
  const token = env.CONFLUENCE_API_TOKEN || env.JIRA_API_TOKEN || '';
  return { baseUrl, email, token, ok: Boolean(baseUrl && email && token) };
}

function authHeader({ email, token }) {
  if (!email || !token) return {};
  const basic = Buffer.from(`${email}:${token}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

async function confluenceFetch(path, env, init = {}) {
  const auth = authConfig(env);
  if (!auth.ok) throw new Error('confluence: base URL + email + token required');
  const res = await fetch(`${auth.baseUrl}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      ...authHeader(auth),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Confluence ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'atlassian-confluence',
      displayName: 'Atlassian Confluence',
      capabilities: ['read', 'search'],
      description: 'Pages, spaces, CQL search.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        pageId: { type: 'string', pattern: '^[0-9]+$' },
        cql: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: HARD_LIMIT, default: DEFAULT_LIMIT },
      },
    },

    async health() {
      const auth = authConfig(env);
      if (!auth.ok) {
        return { ok: false, detail: 'CONFLUENCE_BASE_URL/JIRA_BASE_URL + email + token not set' };
      }
      try {
        await confluenceFetch('/wiki/rest/api/space?limit=1', env);
        return { ok: true, detail: `connected to ${auth.baseUrl}` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    async read(config) {
      if (!config?.pageId) throw new Error('confluence.read: config.pageId required');
      return confluenceFetch(
        `/wiki/rest/api/content/${encodeURIComponent(config.pageId)}?expand=body.storage,version`,
        env
      );
    },

    async search(config) {
      const cql = config?.cql;
      if (!cql) throw new Error('confluence.search: config.cql required');
      const limit = Math.min(config?.limit || DEFAULT_LIMIT, HARD_LIMIT);
      const data = await confluenceFetch(
        `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}`,
        env
      );
      return Array.isArray(data?.results) ? data.results : [];
    },
  };
}

export default create;
