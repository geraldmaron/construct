/**
 * tests/functional/confluence-read-index.functional.test.mjs
 *
 * End to end: register a Confluence space as a team sync target, run
 * demandFetch against a mocked Atlassian API (no live network calls), and
 * assert the fetched page lands in the knowledge store and knowledge_search
 * surfaces it with origin attribution pointing back to Confluence.
 *
 * Exercises the same generic team-source → demandFetch → addObservation →
 * knowledgeSearch pipeline construct-uizpv.7's design doc requires reusing
 * (the path lib/embed/providers/jira.mjs and github.mjs already flow
 * through) rather than a parallel Confluence-only indexing path.
 *
 * demandFetch writes observations through the machine-scoped state root
 * keyed by a hash of the tmp rootDir — CONSTRUCT_HOME_OVERRIDE is
 * pinned for the whole file to keep that write off the real developer
 * machine's $HOME.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';

import { demandFetch } from '../../lib/embed/demand-fetch.mjs';
import { ConfluenceProvider } from '../../lib/embed/providers/confluence.mjs';
import { knowledgeSearch } from '../../lib/knowledge/search.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

let homeOverride;
let prevHomeOverride;

before(() => {
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-confluence-home-'));
  prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
});

after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

// ── Mocked Atlassian wire boundary ──────────────────────────────────────────

const MOCK_PAGE = {
  id: '98765',
  title: 'Onboarding Runbook',
  space: { key: 'ENG' },
  body: { storage: { value: '<p>Rotate the <strong>staging</strong> API key every quarter.</p>' } },
  version: { number: 3, when: '2026-07-01T00:00:00.000Z' },
  _links: { webui: '/spaces/ENG/pages/98765/Onboarding+Runbook' },
};

function mockFetch(url) {
  assert.ok(String(url).includes('/wiki/rest/api/content/search'), `unexpected mocked URL: ${url}`);
  return Promise.resolve({
    ok: true,
    json: async () => ({ results: [MOCK_PAGE] }),
  });
}

test('registering a Confluence space target and running demandFetch indexes pages with Confluence origin attribution', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-fetch-'));
  const prevHome = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = tmp;
  try {
    const confluenceProvider = new ConfluenceProvider({
      baseUrl: 'https://example.atlassian.net',
      email: 'bot@example.com',
      token: 'fake-token',
      fetchFn: mockFetch,
    });
    const providerRegistry = { get: (name) => (name === 'confluence' ? confluenceProvider : null) };

    const registry = {
      teams: {
        'engineering-group': {
          sources: [
            { id: 'eng-space', provider: 'confluence', selector: { space: 'ENG' } },
          ],
        },
      },
    };

    const result = await demandFetch({
      teamId: 'engineering-group',
      rootDir: tmp,
      env: {},
      registry,
      providerRegistry,
    });

    assert.equal(result.ok, true, `demandFetch should succeed: ${JSON.stringify(result)}`);
    assert.equal(result.reason, 'team_fetched');
    assert.equal(result.written, 1, 'the single mocked page was stored as one observation');
    assert.equal(result.items[0].source, 'confluence');
    assert.equal(result.items[0].content.includes('Rotate the staging API key'), true);

    const search = knowledgeSearch({ query: 'staging API key rotate', rootDir: tmp, topK: 5, minScore: 0 });
    assert.equal(search.ok, true, `knowledge_search should succeed: ${JSON.stringify(search)}`);

    const confluenceHit = search.hits.find((h) => h.origin?.provider === 'confluence');
    assert.ok(confluenceHit, `expected a hit with origin.provider === "confluence": ${JSON.stringify(search.hits)}`);
    assert.equal(confluenceHit.origin.targetId, 'eng-space');
    assert.match(confluenceHit.text, /staging API key/);
  } finally {
    if (prevHome === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHome;
    rmTmpDir(tmp);
  }
});
