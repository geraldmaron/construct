/**
 * lib/providers/contract/adapters/confluence/transport.mjs — real Confluence
 * Cloud REST v2 transport for the governed write adapter.
 *
 * Implements the `confluenceTransport` shape governed-write.mjs depends on:
 * `searchPagesByTitle`, `getPage`, `createPage`, `updatePage`,
 * `createFooterComment`. Kept separate from governed-write.mjs so tests can
 * inject a fake transport (tests/fakes/fake-confluence-transport.mjs)
 * without any network dependency, and separate from the read-oriented
 * adapter in ./index.mjs so this write path never shares mutable state with
 * the read path.
 *
 * Auth: API token via CONFLUENCE_URL + CONFLUENCE_EMAIL + CONFLUENCE_TOKEN
 * env vars, or passed directly via config.
 */

import { AuthError, RateLimitError } from '../../errors.mjs';

export function createConfluenceTransport(config = {}) {
  const baseUrl = (config.baseUrl ?? process.env.CONFLUENCE_URL ?? '').replace(/\/$/, '');
  const email = config.email ?? process.env.CONFLUENCE_EMAIL;
  const token = config.token ?? process.env.CONFLUENCE_TOKEN;

  if (!baseUrl || !email || !token) {
    throw new AuthError(
      'Confluence transport requires CONFLUENCE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_TOKEN (or config.baseUrl/email/token)',
      { provider: 'confluence' },
    );
  }

  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new RateLimitError('Confluence rate limit hit', { provider: 'confluence', retryAfter });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Confluence API ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    async searchPagesByTitle(spaceId, title) {
      const params = new URLSearchParams({ title, 'space-id': spaceId, limit: '10' });
      const data = await request(`/wiki/api/v2/pages?${params.toString()}`);
      return (data.results ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        spaceId: p.spaceId,
        version: p.version?.number ?? null,
        url: `${baseUrl}${p._links?.webui ?? ''}`,
      }));
    },

    async getPage(pageId) {
      const data = await request(`/wiki/api/v2/pages/${pageId}?body-format=storage`);
      return {
        id: data.id,
        title: data.title,
        spaceId: data.spaceId,
        version: data.version?.number ?? null,
        body: data.body?.storage?.value ?? '',
        url: `${baseUrl}${data._links?.webui ?? ''}`,
      };
    },

    async createPage({ spaceId, title, body, parentId }) {
      const reqBody = {
        spaceId,
        status: 'current',
        title,
        parentId: parentId ?? undefined,
        body: { representation: 'storage', value: body },
      };
      const data = await request('/wiki/api/v2/pages', { method: 'POST', body: reqBody });
      return {
        id: data.id,
        title: data.title,
        version: data.version?.number ?? 1,
        url: `${baseUrl}${data._links?.webui ?? ''}`,
      };
    },

    async updatePage({ pageId, title, body, version }) {
      const reqBody = {
        id: pageId,
        status: 'current',
        title,
        version: { number: version },
        body: { representation: 'storage', value: body },
      };
      const data = await request(`/wiki/api/v2/pages/${pageId}`, { method: 'PUT', body: reqBody });
      return {
        id: data.id,
        title: data.title,
        version: data.version?.number ?? version,
        url: `${baseUrl}${data._links?.webui ?? ''}`,
      };
    },

    async createFooterComment(pageId, body) {
      const data = await request('/wiki/api/v2/footer-comments', {
        method: 'POST',
        body: { pageId, body: { representation: 'storage', value: body } },
      });
      return {
        id: data.id,
        url: `${baseUrl}${data._links?.webui ?? ''}`,
      };
    },
  };
}

export default createConfluenceTransport;
