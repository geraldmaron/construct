/**
 * lib/providers/contract/adapters/confluence/governed-write.mjs —
 * envelope-shaped Confluence write adapter.
 *
 * Wraps a Confluence REST transport in the provider shape
 * lib/writes/envelope.mjs expects: write(config, payload), meta.id,
 * search(). This is the only exposed entry point for Confluence writes —
 * specialists and CLI callers route through writeWithEnvelope(), never
 * through a raw Confluence client, so dedup, retry, dry-run, approval, and
 * audit stay centralized in the envelope (LMCP-J2) rather than being
 * reimplemented per-adapter.
 *
 * Adds the three behaviors a generic envelope cannot provide:
 *
 *   - Duplicate detection by title+space: before create, searches the
 *     target space for an existing page with the same title (via the
 *     injected `confluenceTransport.searchPagesByTitle`). A match returns a
 *     `page-duplicate` result carrying a `linkback` to the existing page
 *     instead of creating a second page — mirrors the GitHub adapter's
 *     marker-search dedup (LMCP-J-github) but keyed on title+space rather
 *     than a hidden marker, since Confluence page search has no analogue to
 *     GitHub's full-text issue search over a hidden comment.
 *   - Version-conflict recovery on update: Confluence page updates require
 *     the current `version.number`; if the page changed since the caller
 *     last fetched it, the API returns 409. On 409 this adapter refetches
 *     the live page, re-renders the caller's update against the fresh
 *     version, and returns a `version-conflict` result carrying the fresh
 *     page and a `retryPayload` — the caller (or a human via the envelope's
 *     approval path) re-approves before the adapter retries the write. The
 *     adapter never blindly overwrites a page that changed underneath it.
 *   - Linkback comment: after a successful create or update, posts a footer
 *     comment on the page recording the write's idempotency key, so anyone
 *     reading the page in Confluence can trace which governed write
 *     produced or last touched it.
 */

import { AuthError } from '../../errors.mjs';

const LINKBACK_PREFIX = 'construct:write:';

function linkbackComment(idempotencyKey) {
  return `<p>Published via Construct governed write (${LINKBACK_PREFIX}${idempotencyKey}).</p>`;
}

/**
 * @param {object} opts
 * @param {object} opts.confluenceTransport - underlying Confluence REST transport; must implement
 *   `searchPagesByTitle(spaceId, title)`, `getPage(pageId)`, `createPage(fields)`,
 *   `updatePage(fields)`, `createFooterComment(pageId, body)`.
 */
export function createGovernedConfluenceProvider({ confluenceTransport } = {}) {
  if (!confluenceTransport) throw new Error('createGovernedConfluenceProvider: confluenceTransport is required');

  async function postLinkback(pageId, idempotencyKey) {
    if (!idempotencyKey) return;
    try {
      await confluenceTransport.createFooterComment(pageId, linkbackComment(idempotencyKey));
    } catch {
      // Linkback is best-effort audit trail on the page itself; the
      // envelope's sent-log is the authoritative record, so a comment
      // failure must not fail an otherwise-successful publish.
    }
  }

  async function writePage(payload) {
    const { spaceId, title, body, parentId, idempotencyKey } = payload;
    if (!spaceId) throw new Error('confluence governed write: payload.spaceId is required for type "page"');
    if (!title) throw new Error('confluence governed write: payload.title is required for type "page"');

    let existing;
    try {
      existing = await confluenceTransport.searchPagesByTitle(spaceId, title);
    } catch (err) {
      throw mapWriteTransportError(err, { spaceId });
    }

    const match = (existing ?? []).find((p) => p.title === title);
    if (match) {
      return {
        type: 'page-duplicate',
        id: match.id,
        title: match.title,
        url: match.url,
        linkback: match.url,
      };
    }

    try {
      const result = await confluenceTransport.createPage({ spaceId, title, body, parentId });
      await postLinkback(result.id, idempotencyKey);
      return { type: 'page-created', id: result.id, title: result.title, version: result.version, url: result.url };
    } catch (err) {
      throw mapWriteTransportError(err, { spaceId });
    }
  }

  async function writePageUpdate(payload) {
    const { pageId, title, body, version, idempotencyKey } = payload;
    if (!pageId) throw new Error('confluence governed write: payload.pageId is required for type "page-update"');
    if (version === undefined || version === null) {
      throw new Error('confluence governed write: payload.version is required for type "page-update"');
    }

    try {
      const result = await confluenceTransport.updatePage({ pageId, title, body, version });
      await postLinkback(pageId, idempotencyKey);
      return { type: 'page-updated', id: result.id, title: result.title, version: result.version, url: result.url };
    } catch (err) {
      if (err?.status === 409) {
        const fresh = await confluenceTransport.getPage(pageId);
        return {
          type: 'version-conflict',
          id: pageId,
          url: fresh.url,
          currentVersion: fresh.version,
          currentBody: fresh.body,
          currentTitle: fresh.title,
          retryPayload: {
            type: 'page-update',
            pageId,
            title: title ?? fresh.title,
            body,
            version: fresh.version,
            idempotencyKey,
          },
        };
      }
      throw mapWriteTransportError(err, { pageId });
    }
  }

  return {
    meta: {
      id: 'confluence',
      displayName: 'Confluence (governed)',
      capabilities: ['write', 'search'],
      description: 'Envelope-routed Confluence writes with title+space dedup, version-conflict recovery, and linkback comments.',
    },

    async write(config, payload) {
      if (payload?.type === 'page') return writePage(payload);
      if (payload?.type === 'page-update') return writePageUpdate(payload);
      throw new Error(`confluence governed write: unsupported type "${payload?.type}" (only 'page' and 'page-update' are supported)`);
    },

    async search(config, query) {
      const spaceId = typeof query === 'object' ? query?.spaceId : undefined;
      const title = typeof query === 'object' ? query?.title : query;
      return confluenceTransport.searchPagesByTitle(spaceId, title);
    },

    /**
     * Render the payload the envelope would submit, without calling search,
     * getPage, or the transport. Feeds the envelope's dry-run path
     * (lib/writes/envelope.mjs `dryRun: true`), giving a human reviewing a
     * pending write the exact storage-format body and target coordinates
     * before anything is sent.
     *
     * @param {object} payload
     * @returns {{ type: string, fields: object }}
     */
    renderDryRun(payload) {
      if (payload?.type === 'page') {
        return {
          type: 'page',
          fields: {
            spaceId: payload.spaceId,
            title: payload.title,
            parentId: payload.parentId,
            body: { representation: 'storage', value: payload.body },
          },
        };
      }
      if (payload?.type === 'page-update') {
        return {
          type: 'page-update',
          fields: {
            pageId: payload.pageId,
            title: payload.title,
            version: { number: payload.version },
            body: { representation: 'storage', value: payload.body },
          },
        };
      }
      throw new Error(`confluence governed write: cannot render dry-run for unsupported type "${payload?.type}"`);
    },
  };
}

/**
 * Map a create/update/search transport failure (401/403/404) to an
 * actionable message. 409 (version conflict) is handled by the caller
 * directly and never reaches this mapper.
 *
 * @param {Error & {status?: number}} err
 * @param {{ spaceId?: string, pageId?: string }} ctx
 * @returns {Error}
 */
function mapWriteTransportError(err, ctx) {
  const status = err?.status;
  if (status === 401) {
    return new AuthError('Confluence authentication failed. Check CONFLUENCE_EMAIL / CONFLUENCE_TOKEN.', { provider: 'confluence' });
  }
  if (status === 403) {
    const target = ctx.spaceId ? `space "${ctx.spaceId}"` : `page "${ctx.pageId}"`;
    return new Error(`Forbidden: the authenticated account lacks permission to write to ${target}. Check the confluence-content:write scope.`);
  }
  if (status === 404) {
    const target = ctx.spaceId ? `Space "${ctx.spaceId}"` : `Page "${ctx.pageId}"`;
    return new Error(`${target} was not found, or the authenticated account cannot access it.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export default createGovernedConfluenceProvider;
