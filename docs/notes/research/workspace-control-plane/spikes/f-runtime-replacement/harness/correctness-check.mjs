/**
 * correctness-check.mjs — spike F evidence harness.
 *
 * Exercises the REST-based github transport (harness/work/lib/.../index.mjs,
 * a copy of the new adapter) end to end against a local loopback HTTP server
 * that mimics the GitHub REST API surface the transport calls. No real
 * network call, no real token. Proves init/read/write/search/error-mapping
 * all work against the new runtime, independent of the checked-in unit
 * tests (which never call init() or exercise a live-shaped request/response
 * cycle). Run: node correctness-check.mjs
 */

import http from 'node:http';
import assert from 'node:assert/strict';

const requestsLog = [];

function startMockServer() {
  let rateLimitCallsRemaining = 1;
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      requestsLog.push({ method: req.method, url: req.url, body });

      if (req.url === '/user') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ login: 'spike-bot' }));
      }
      if (req.url.startsWith('/repos/acme/widgets/issues?state=open')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify([
          { number: 1, title: 'Real issue', pull_request: undefined },
          { number: 2, title: 'A PR masquerading as an issue', pull_request: {} },
        ]));
      }
      if (req.method === 'POST' && req.url === '/repos/acme/widgets/issues') {
        if (rateLimitCallsRemaining > 0) {
          rateLimitCallsRemaining -= 1;
          res.writeHead(403, { 'content-type': 'application/json', 'retry-after': '1' });
          return res.end(JSON.stringify({ message: 'You have exceeded a secondary rate limit' }));
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ html_url: 'http://mock/acme/widgets/issues/9' }));
      }
      if (req.url.startsWith('/search/issues')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ items: [{ number: 9, title: 'Real issue' }] }));
      }
      if (req.url === '/repos/acme/widgets/pulls/404') {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'Not Found' }));
      }
      res.writeHead(500);
      res.end(JSON.stringify({ message: `mock server: unhandled ${req.method} ${req.url}` }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const server = await startMockServer();
  const { port } = server.address();
  const apiBase = `http://127.0.0.1:${port}`;

  const { default: provider } = await import('./work/lib/providers/contract/adapters/github/index.mjs');
  const { RateLimitError, NotFoundError } = await import('./work/lib/providers/contract/errors.mjs');

  let passed = 0;
  const check = (label, fn) => {
    fn();
    passed += 1;
    console.log(`  ok  ${label}`);
  };

  await provider.init({ apiBase, token: 'fake-token', repo: 'acme/widgets' });
  check('init() authenticates against /user and stores repo/token', () => {
    assert.equal(requestsLog[0].url, '/user');
  });

  const issues = await provider.read('issues');
  check('read("issues") filters out items carrying pull_request', () => {
    assert.equal(issues.length, 1);
    assert.equal(issues[0].number, 1);
  });

  // First write attempt hits the mock server's injected secondary-rate-limit
  // (403 + Retry-After: 1), confirming the header-based RateLimitError path.
  let rateLimited = false;
  try {
    await provider.write({ type: 'issue', title: 'Real issue', body: 'x' });
  } catch (err) {
    rateLimited = err instanceof RateLimitError && err.retryAfter === 1;
  }
  check('write() maps a 403 secondary-rate-limit body to RateLimitError with header-derived retryAfter=1', () => {
    assert.ok(rateLimited, 'expected a RateLimitError with retryAfter=1 on the first attempt');
  });

  const created = await provider.write({ type: 'issue', title: 'Real issue', body: 'x' });
  check('write() succeeds on retry and returns the created html_url', () => {
    assert.equal(created.type, 'issue-created');
    assert.equal(created.url, 'http://mock/acme/widgets/issues/9');
  });

  const results = await provider.search('Real issue', { scope: 'issues' });
  check('search() qualifies the query with repo: and unwraps .items', () => {
    assert.equal(results.length, 1);
    const searchReq = requestsLog.find((r) => r.url.startsWith('/search/issues'));
    assert.ok(searchReq.url.includes('repo%3Aacme%2Fwidgets') || searchReq.url.includes('repo:acme/widgets'));
  });

  let notFound = false;
  try {
    await provider.read('pr:404');
  } catch (err) {
    notFound = err instanceof NotFoundError;
  }
  check('a 404 response maps to NotFoundError', () => {
    assert.ok(notFound);
  });

  server.close();
  console.log(`\n${passed}/${passed} correctness checks passed against the mock REST server.`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
