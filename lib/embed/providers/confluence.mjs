/**
 * lib/embed/providers/confluence.mjs — Confluence (Atlassian) provider for embed mode.
 *
 * Reads pages from Confluence Cloud/Server using the REST API v1 content
 * search endpoint (CQL). Zero external deps — uses Node's built-in fetch.
 * Mirrors lib/embed/providers/jira.mjs's shape (constructor, defaultSources,
 * read(ref, opts)) so both providers plug into the same ProviderRegistry and
 * demand-fetch dispatch without provider-specific branching there.
 *
 * Supported refs:
 *   pages   Pages matching a CQL query or space filter
 *
 * Source config fields (embed.yaml):
 *   provider: confluence
 *   space: ENG                  # space key — drives the default CQL
 *   spaces:                     # OR list of space keys
 *     - ENG
 *     - PLATFORM
 *   cql: "space = ENG AND type = page"   # override CQL
 *   jql: same as `cql` — demand-fetch's generic template dispatch always
 *        names its rendered query opts field `jql` regardless of provider
 *        (see lib/embed/demand-fetch.mjs buildReadCallsForTarget); accepted
 *        here as an alias so that shared path works unmodified.
 *   refs: [pages]
 *   limit: 25                   # max pages (default: 25)
 *
 * Returned items use `type: 'doc'` (not `type: 'page'`) so
 * lib/embed/demand-fetch.mjs#buildObservationContent stores the full page
 * body (its `doc` branch) instead of truncating to 500 chars.
 */

export class ConfluenceProvider {
  #baseUrl;
  #auth;
  #fetchFn;

  constructor({ baseUrl, email, token, fetchFn = globalThis.fetch } = {}) {
    if (!baseUrl || !email || !token) {
      throw new Error('ConfluenceProvider requires baseUrl, email, and token');
    }
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.#fetchFn = fetchFn;
  }

  /**
   * Default sources used when no embed.yaml is present.
   * No space is assumed by default — Confluence has no equivalent of Jira's
   * "assignee = currentUser()" without a configured space/CQL.
   */
  defaultSources() {
    return [];
  }

  /**
   * @param {string} ref      - 'pages'
   * @param {object} opts     - source config (space, spaces, cql, jql, limit)
   * @returns {Promise<Item[]>}
   */
  async read(ref, opts = {}) {
    switch (ref) {
      case 'pages': return this.#listPages(opts);
      default:      throw new Error(`Confluence provider: unknown ref "${ref}"`);
    }
  }

  async #listPages(opts) {
    const limit = Number(opts.limit ?? 25);
    const cql = opts.cql ?? opts.jql ?? buildDefaultCql(opts);

    const data = await this.#get(
      `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=body.storage,space,version`,
    );

    return (data.results ?? []).map((page) => ({
      type: 'doc',
      source: 'confluence',
      id: page.id,
      title: page.title ?? '',
      space: page.space?.key ?? resolveSpaces(opts)[0] ?? null,
      path: `${page.space?.key ?? ''}/${page.title ?? ''}`,
      content: stripStorageHtml(page.body?.storage?.value ?? ''),
      version: page.version?.number ?? null,
      url: page._links?.webui ? `${this.#baseUrl}${page._links.webui}` : `${this.#baseUrl}/wiki/pages/${page.id}`,
      updatedAt: page.version?.when ?? null,
      summary: `[${page.space?.key ?? ''}] ${page.title ?? ''}`,
    }));
  }

  async #get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await this.#fetchFn(`${this.#baseUrl}${path}`, {
        headers: { Authorization: this.#auth, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Confluence API ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveSpaces(opts) {
  if (Array.isArray(opts.spaces)) return opts.spaces.filter(Boolean);
  if (opts.space) return [opts.space];
  return [];
}

function buildDefaultCql(opts) {
  const spaces = resolveSpaces(opts);
  const spaceClause = spaces.length
    ? `space in (${spaces.map((s) => `"${s}"`).join(', ')}) AND `
    : '';
  return `${spaceClause}type = page ORDER BY lastmodified DESC`;
}

/**
 * Confluence storage format is XHTML with vendor macros. Retrieval only
 * needs searchable text, so tags are stripped and entities unescaped rather
 * than parsed into a structural tree.
 */
function stripStorageHtml(storageValue) {
  return String(storageValue)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
