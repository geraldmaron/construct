/**
 * providers/confluence/index.mjs — Confluence provider.
 *
 * Transport: Confluence REST API v2 (direct fetch, no SDK).
 * Auth: API token via CONFLUENCE_TOKEN + CONFLUENCE_EMAIL + CONFLUENCE_URL,
 *       or passed directly in config.
 *
 * Capabilities: read, write, search
 *
 * read refs:
 *   "page:<id>"                  → single page by ID
 *   "space:<key>:pages"          → pages in a space
 *   "space:<key>:pages:<n>"      → first n pages in a space
 *   "spaces"                     → list all accessible spaces
 *
 * write items:
 *   { type: 'page', spaceId, title, body, parentId? }   → create page
 *   { type: 'page-update', pageId, title, body, version } → update page
 *   { type: 'comment', pageId, body }                   → add footer comment
 *
 * search: CQL query string (e.g. "space = DEV AND title ~ 'RFC'")
 */

import { AuthError, NotFoundError, RateLimitError } from '../lib/errors.mjs';

export default {
  name: 'confluence',
  capabilities: ['read', 'write', 'search'],

  _baseUrl: null,
  _auth: null,

  async init(config = {}) {
    const url = config.baseUrl ?? process.env.CONFLUENCE_URL;
    const email = config.email ?? process.env.CONFLUENCE_EMAIL;
    const token = config.token ?? process.env.CONFLUENCE_TOKEN;

    if (!url || !email || !token) {
      throw new AuthError(
        'Confluence provider requires CONFLUENCE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_TOKEN',
        { provider: 'confluence' },
      );
    }

    this._baseUrl = url.replace(/\/$/, '');
    this._auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

    const res = await this._fetch('/wiki/rest/api/user/current');
    if (!res.ok) {
      throw new AuthError(`Confluence auth failed: ${res.status} ${res.statusText}`, { provider: 'confluence' });
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
      throw new RateLimitError('Confluence rate limit hit', { provider: 'confluence', retryAfter });
    }
    return res;
  },

  async read(ref, _opts = {}) {
    if (ref === 'spaces') {
      const res = await this._fetch('/wiki/api/v2/spaces?limit=50');
      if (!res.ok) throw new Error(`Confluence error: ${res.status}`);
      const data = await res.json();
      return (data.results ?? []).map((s) => ({
        type: 'space',
        id: s.id,
        key: s.key,
        name: s.name,
        homepageId: s.homepageId,
      }));
    }

    if (ref.startsWith('page:')) {
      const pageId = ref.slice(5);
      const res = await this._fetch(`/wiki/api/v2/pages/${pageId}?body-format=storage`);
      if (res.status === 404) throw new NotFoundError(`Page not found: ${pageId}`, { provider: 'confluence' });
      if (!res.ok) throw new Error(`Confluence error: ${res.status}`);
      return [normalizePage(await res.json())];
    }

    const spaceMatch = ref.match(/^space:([^:]+):pages(?::(\d+))?$/);
    if (spaceMatch) {
      const spaceKey = spaceMatch[1];
      const limit = parseInt(spaceMatch[2] ?? '25', 10);
      // Look up space id from key first
      const spacesRes = await this._fetch(`/wiki/api/v2/spaces?keys=${spaceKey}&limit=1`);
      const spacesData = await spacesRes.json();
      const space = spacesData.results?.[0];
      if (!space) throw new NotFoundError(`Space not found: ${spaceKey}`, { provider: 'confluence' });
      const res = await this._fetch(`/wiki/api/v2/spaces/${space.id}/pages?limit=${limit}&body-format=storage`);
      if (!res.ok) throw new Error(`Confluence error: ${res.status}`);
      const data = await res.json();
      return (data.results ?? []).map(normalizePage);
    }

    throw new NotFoundError(`Unknown Confluence read ref: "${ref}"`, { provider: 'confluence' });
  },

  async write(item) {
    if (item.type === 'page') {
      const body = {
        spaceId: item.spaceId,
        title: item.title,
        parentId: item.parentId ?? undefined,
        body: { representation: 'storage', value: item.body },
      };
      const res = await this._fetch('/wiki/api/v2/pages', { method: 'POST', body });
      if (!res.ok) throw new Error(`Confluence create page failed: ${res.status}`);
      const data = await res.json();
      return { type: 'page-created', id: data.id, title: data.title };
    }

    if (item.type === 'page-update') {
      const body = {
        id: item.pageId,
        title: item.title,
        version: { number: item.version },
        body: { representation: 'storage', value: item.body },
      };
      const res = await this._fetch(`/wiki/api/v2/pages/${item.pageId}`, { method: 'PUT', body });
      if (!res.ok) throw new Error(`Confluence update page failed: ${res.status}`);
      return { type: 'page-updated', id: item.pageId };
    }

    if (item.type === 'comment') {
      const body = {
        pageId: item.pageId,
        body: { representation: 'storage', value: item.body },
      };
      const res = await this._fetch('/wiki/api/v2/footer-comments', { method: 'POST', body });
      if (!res.ok) throw new Error(`Confluence create comment failed: ${res.status}`);
      const data = await res.json();
      return { type: 'comment-created', id: data.id };
    }

    throw new Error(`Unknown Confluence write item type: "${item.type}"`);
  },

  async search(query, opts = {}) {
    const limit = opts.limit ?? 25;
    const cql = encodeURIComponent(query);
    const res = await this._fetch(`/wiki/rest/api/content/search?cql=${cql}&limit=${limit}`);
    if (!res.ok) throw new Error(`Confluence search failed: ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map((r) => ({
      type: 'page',
      id: r.id,
      title: r.title,
      spaceKey: r.space?.key,
      url: r._links?.webui ?? null,
    }));
  },
};

function normalizePage(raw) {
  return {
    type: 'page',
    id: raw.id,
    title: raw.title,
    spaceId: raw.spaceId,
    parentId: raw.parentId ?? null,
    version: raw.version?.number ?? null,
    body: raw.body?.storage?.value ?? null,
    createdAt: raw.createdAt ?? null,
    url: raw._links?.webui ?? null,
  };
}
