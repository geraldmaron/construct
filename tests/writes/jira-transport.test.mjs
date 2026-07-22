/**
 * tests/writes/jira-transport.test.mjs — real Jira Cloud REST v3 transport
 * (lib/providers/contract/adapters/jira/transport.mjs), ADR-0095 migration.
 *
 * Exercises the transport against a local HTTP server (same pattern as
 * tests/security/ssrf.test.mjs) rather than a fake, since the exact
 * URLs/methods/bodies the transport sends are the assertion target — a fake
 * at the `jiraTransport` boundary (tests/fakes/fake-jira-transport.mjs) sits
 * above that layer and would hide it. Covers: `fetchCreatemeta` calling
 * the `issue/createmeta/{projectIdOrKey}/issuetypes[/{issueTypeId}]` pair
 * instead of the deprecated single-call endpoint and re-synthesizing the
 * shape createmeta.mjs expects; `searchIssues` calling `search/jql` with an
 * explicit `fields` array and tolerating a `nextPageToken`-shaped response
 * with no `startAt`/`total`; and 401/403 responses surfacing a token-expiry
 * hint rather than a generic auth-failure message.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createJiraTransport } from '../../lib/providers/contract/adapters/jira/transport.mjs';

/**
 * Start a local HTTP server that serves canned JSON responses from `routes`
 * (keyed by `${method} ${path}`) and records every request it receives.
 *
 * @param {Record<string, {status?: number, body: object}>} routes
 * @returns {Promise<{ baseUrl: string, requests: Array<{method: string, url: string, body: any}>, close: () => Promise<void> }>}
 */
async function startFakeJiraServer(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, body });

      const route = routes[`${req.method} ${req.url}`];
      if (!route) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ errorMessages: [`no route for ${req.method} ${req.url}`] }));
        return;
      }
      res.statusCode = route.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(route.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('jira transport — createmeta migration (ADR-0095)', () => {
  it('calls issue/createmeta/{projectIdOrKey}/issuetypes then .../issuetypes/{id}, never the deprecated single-call endpoint', async () => {
    const server = await startFakeJiraServer({
      'GET /rest/api/3/issue/createmeta/PROJ/issuetypes': {
        body: { maxResults: 50, startAt: 0, total: 1, isLast: true, values: [{ id: '10001', name: 'Task' }] },
      },
      'GET /rest/api/3/issue/createmeta/PROJ/issuetypes/10001': {
        body: {
          maxResults: 50,
          startAt: 0,
          total: 2,
          isLast: true,
          values: [
            { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string' } },
            { fieldId: 'customfield_10099', name: 'Custom', required: true, schema: { type: 'string' } },
          ],
        },
      },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      const raw = await transport.fetchCreatemeta('PROJ', 'Task');

      assert.deepEqual(
        server.requests.map((r) => `${r.method} ${r.url}`),
        [
          'GET /rest/api/3/issue/createmeta/PROJ/issuetypes',
          'GET /rest/api/3/issue/createmeta/PROJ/issuetypes/10001',
        ],
      );
      assert.ok(
        !server.requests.some((r) => r.url === '/rest/api/3/issue/createmeta' || r.url.startsWith('/rest/api/3/issue/createmeta?')),
        'must never call the deprecated single-call createmeta endpoint',
      );

      assert.deepEqual(raw, {
        projects: [
          {
            key: 'PROJ',
            issuetypes: [
              {
                id: '10001',
                name: 'Task',
                fields: {
                  summary: { required: true, schema: { type: 'string' } },
                  customfield_10099: { required: true, schema: { type: 'string' } },
                },
              },
            ],
          },
        ],
      });
    } finally {
      await server.close();
    }
  });

  it('an issue type absent from the issuetypes list synthesizes an empty-issuetypes project (unknown-issue-type path, no second call)', async () => {
    const server = await startFakeJiraServer({
      'GET /rest/api/3/issue/createmeta/PROJ/issuetypes': {
        body: { values: [{ id: '10001', name: 'Task' }] },
      },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      const raw = await transport.fetchCreatemeta('PROJ', 'Epic');

      assert.equal(server.requests.length, 1, 'must not fetch field metadata for an issue type that was never matched');
      assert.deepEqual(raw, { projects: [{ key: 'PROJ', issuetypes: [] }] });
    } finally {
      await server.close();
    }
  });
});

describe('jira transport — search/jql migration (ADR-0095)', () => {
  it('calls search/jql (not the deprecated search endpoint) with an explicit fields array, and translates a nextPageToken-shaped response', async () => {
    const server = await startFakeJiraServer({
      'POST /rest/api/3/search/jql': {
        body: {
          issues: [
            { id: '1', key: 'PROJ-1', fields: { summary: 'Fix the bug', status: { name: 'Open' } } },
          ],
          nextPageToken: 'opaque-cursor-abc',
          isLast: false,
        },
      },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      const results = await transport.searchIssues('project = PROJ');

      assert.equal(server.requests.length, 1);
      assert.equal(server.requests[0].method, 'POST');
      assert.equal(server.requests[0].url, '/rest/api/3/search/jql');
      assert.deepEqual(server.requests[0].body, {
        jql: 'project = PROJ',
        maxResults: 50,
        fields: ['summary', 'status'],
      });

      assert.deepEqual(results, [
        { id: '1', key: 'PROJ-1', summary: 'Fix the bug', url: `${server.baseUrl}/browse/PROJ-1` },
      ]);
    } finally {
      await server.close();
    }
  });

  it('never calls the deprecated POST /rest/api/3/search endpoint', async () => {
    const server = await startFakeJiraServer({
      'POST /rest/api/3/search/jql': { body: { issues: [] } },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      await transport.searchIssues('project = PROJ');

      assert.ok(!server.requests.some((r) => r.url === '/rest/api/3/search'));
    } finally {
      await server.close();
    }
  });
});

describe('jira transport — auth-error token-expiry hint', () => {
  it('a 401 response surfaces an actionable message naming token expiry as a possible cause', async () => {
    const server = await startFakeJiraServer({
      'POST /rest/api/3/search/jql': { status: 401, body: { errorMessages: ['Unauthorized'] } },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      await assert.rejects(
        () => transport.searchIssues('project = PROJ'),
        (err) => {
          assert.equal(err.status, 401);
          assert.match(err.message, /expired|revoked/i);
          assert.match(err.message, /1 year/i);
          return true;
        },
      );
    } finally {
      await server.close();
    }
  });

  it('a 403 response surfaces an actionable message naming token expiry as a possible cause', async () => {
    const server = await startFakeJiraServer({
      'GET /rest/api/3/issue/createmeta/PROJ/issuetypes': { status: 403, body: { errorMessages: ['Forbidden'] } },
    });
    try {
      const transport = createJiraTransport({
        baseUrl: server.baseUrl,
        email: 'x@y.z',
        token: 't',
        allowPrivateEgress: true,
      });

      await assert.rejects(
        () => transport.fetchCreatemeta('PROJ', 'Task'),
        (err) => {
          assert.equal(err.status, 403);
          assert.match(err.message, /expired|revoked/i);
          assert.match(err.message, /1 year/i);
          return true;
        },
      );
    } finally {
      await server.close();
    }
  });
});
