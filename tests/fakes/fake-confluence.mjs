/**
 * tests/fakes/fake-confluence.mjs — in-memory fake Confluence provider.
 *
 * Satisfies the provider contract (lib/providers/contract.mjs) so it can be
 * validated by assertProviderContract at test time. Never makes real network
 * calls. All state is held in the closure returned by create().
 *
 * Usage:
 *   import { FakeConfluence } from './index.mjs';
 *   const fake = FakeConfluence.create();
 *
 *   // Happy path
 *   const page = await fake.createPage('ENG', { title: 'RFC-001', body: '<p>…</p>' });
 *
 *   // Failure modes
 *   fake.setMode('version-conflict');
 *   fake.setMode('scope-denied');
 *
 *   // Inspection / reset
 *   fake.getCreatedPages();
 *   fake.reset();
 *
 * Implements the provider write() contract shape:
 *   write(config, payload) => result
 * where payload = { type: 'page', spaceKey, title, body }
 */

let _seq = 200;

function nextId() {
  return String(_seq++);
}

/**
 * Create a FakeConfluence provider instance conforming to the registry contract.
 */
export function create() {
  /** @type {Array<{id: string, title: string, url: string, spaceKey: string, body: string}>} */
  const _pages = [];
  let _mode = 'normal'; // 'normal' | 'version-conflict' | 'scope-denied'

  // ── private helpers ──────────────────────────────────────────────────────

  function _buildPage(spaceKey, { title, body = '' }) {
    const id = nextId();
    return {
      id,
      title,
      url: `https://confluence.example.com/wiki/spaces/${spaceKey}/pages/${id}`,
      spaceKey,
      body,
    };
  }

  // ── public test-helper API ────────────────────────────────────────────────

  /**
   * Set the active failure mode.
   * @param {'normal'|'version-conflict'|'scope-denied'} mode
   */
  function setMode(mode) {
    const valid = ['normal', 'version-conflict', 'scope-denied'];
    if (!valid.includes(mode)) {
      throw new Error(`FakeConfluence: unknown mode '${mode}'. Valid: ${valid.join(', ')}`);
    }
    _mode = mode;
  }

  /** Reset all state (created pages + mode). */
  function reset() {
    _pages.length = 0;
    _mode = 'normal';
  }

  /** Return a copy of all pages created so far. */
  function getCreatedPages() {
    return _pages.map((p) => ({ ...p }));
  }

  /**
   * Ergonomic helper for tests.
   * @param {string} spaceKey  e.g. 'ENG'
   * @param {{ title: string, body?: string }} opts
   * @returns {{ id: string, title: string, url: string }}
   */
  async function createPage(spaceKey, { title, body = '' } = {}) {
    if (_mode === 'version-conflict') {
      const err = new Error('Version conflict');
      err.status = 409;
      throw err;
    }

    if (_mode === 'scope-denied') {
      const err = new Error('Insufficient scope');
      err.status = 403;
      throw err;
    }

    const page = _buildPage(spaceKey, { title, body });
    _pages.push(page);
    return { id: page.id, title: page.title, url: page.url };
  }

  // ── provider contract implementation ─────────────────────────────────────

  async function write(_config, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('FakeConfluence.write: payload must be an object');
    }
    if (payload.type === 'page') {
      const { spaceKey = 'TEST', title, body } = payload;
      return createPage(spaceKey, { title, body });
    }
    throw new Error(`FakeConfluence.write: unknown type '${payload.type}'`);
  }

  async function read(_config, _query) {
    // Minimal implementation to satisfy the 'read' capability declaration.
    return [];
  }

  async function search(_config, _query) {
    const cql = typeof _query === 'string' ? _query : (_query?.cql ?? '');
    // Very naive CQL simulation: filter by space key if "space = KEY" appears.
    const match = cql.match(/space\s*=\s*["']?([A-Z]+)["']?/i);
    const filtered = match
      ? _pages.filter((p) => p.spaceKey === match[1].toUpperCase())
      : _pages;
    return filtered.map((p) => ({ ...p }));
  }

  async function health() {
    return { ok: true, detail: 'fake-confluence: always healthy' };
  }

  return Object.assign(
    {
      meta: {
        id: 'fake-confluence',
        displayName: 'Fake Confluence',
        capabilities: ['read', 'search', 'write'],
        description: 'In-memory fake Confluence provider for tests. No real network calls.',
      },
      health,
      read,
      search,
      write,
    },
    // test-helper surface
    { setMode, reset, getCreatedPages, createPage },
  );
}

export default create;
