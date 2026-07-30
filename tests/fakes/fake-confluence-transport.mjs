/**
 * tests/fakes/fake-confluence-transport.mjs — in-memory fake Confluence REST
 * transport for the governed write adapter.
 *
 * Implements the `confluenceTransport` shape required by
 * lib/providers/contract/adapters/confluence/governed-write.mjs:
 * searchPagesByTitle, getPage, createPage, updatePage, createFooterComment.
 * Distinct from tests/fakes/fake-confluence.mjs (the pre-existing flat
 * write() fake exercised in tests/fakes/fake-providers.test.mjs) — this
 * double models per-space pages with version numbers so tests can exercise
 * title+space dedup search and version-conflict recovery, not just a flat
 * create/reject switch.
 *
 * Usage:
 *   import { createFakeConfluenceTransport } from './fake-confluence-transport.mjs';
 *   const transport = createFakeConfluenceTransport();
 *   transport.setMode('version-conflict');
 */

let _seq = 300;

function nextId() {
  return String(_seq++);
}

export function createFakeConfluenceTransport() {
  const pages = [];
  const comments = [];
  let mode = 'normal'; // 'normal' | 'version-conflict' | 'scope-denied' | 'not-found'
  let searchCallCount = 0;
  let createCallCount = 0;
  let updateCallCount = 0;

  function urlFor(id) {
    return `https://confluence.example.com/wiki/spaces/pages/${id}`;
  }

  return {
    // ── inspection / control surface ──────────────────────────────────────
    getPages: () => pages.map((p) => ({ ...p })),
    getComments: () => comments.map((c) => ({ ...c })),
    setMode: (next) => { mode = next; },
    reset: () => { pages.length = 0; comments.length = 0; mode = 'normal'; },
    searchCallCount: () => searchCallCount,
    createCallCount: () => createCallCount,
    updateCallCount: () => updateCallCount,

    /** Seed an existing page directly, bypassing createPage, for dedup/conflict setup. */
    seedPage({ spaceId, title, body = '', version = 1 }) {
      const id = nextId();
      const page = { id, spaceId, title, body, version, url: urlFor(id) };
      pages.push(page);
      return { ...page };
    },

    // ── confluenceTransport contract ───────────────────────────────────────

    async searchPagesByTitle(spaceId, title) {
      searchCallCount += 1;
      if (mode === 'scope-denied') {
        const err = new Error('Insufficient scope');
        err.status = 403;
        throw err;
      }
      return pages
        .filter((p) => p.spaceId === spaceId && p.title === title)
        .map((p) => ({ id: p.id, title: p.title, spaceId: p.spaceId, version: p.version, url: p.url }));
    },

    async getPage(pageId) {
      const page = pages.find((p) => p.id === pageId);
      if (!page) {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      return { ...page };
    },

    async createPage({ spaceId, title, body, parentId }) {
      createCallCount += 1;
      if (mode === 'scope-denied') {
        const err = new Error('Insufficient scope');
        err.status = 403;
        throw err;
      }
      if (mode === 'not-found') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      const id = nextId();
      const page = { id, spaceId, title, body, parentId, version: 1, url: urlFor(id) };
      pages.push(page);
      return { id, title, version: 1, url: page.url };
    },

    async updatePage({ pageId, title, body, version }) {
      updateCallCount += 1;
      if (mode === 'scope-denied') {
        const err = new Error('Insufficient scope');
        err.status = 403;
        throw err;
      }
      const page = pages.find((p) => p.id === pageId);
      if (!page) {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      if (mode === 'version-conflict' || version !== page.version) {
        const err = new Error('Version conflict');
        err.status = 409;
        throw err;
      }
      page.title = title ?? page.title;
      page.body = body;
      page.version += 1;
      return { id: page.id, title: page.title, version: page.version, url: page.url };
    },

    async createFooterComment(pageId, body) {
      const page = pages.find((p) => p.id === pageId);
      if (!page) {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      const id = nextId();
      const comment = { id, pageId, body, url: `${page.url}?focusedCommentId=${id}` };
      comments.push(comment);
      return { id, url: comment.url };
    },
  };
}

export default createFakeConfluenceTransport;
