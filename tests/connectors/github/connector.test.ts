/**
 * tests/connectors/github/connector.test.ts — the connector against a
 * scripted gh, never a real one: every call the read and apply paths make,
 * and what each shape of answer turns into.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubConnector } from '../../../src/connectors/github/connector.ts';
import type { GhExec, GhResult } from '../../../src/connectors/github/connector.ts';

function scripted(handler: (args: readonly string[]) => GhResult): {
  readonly exec: GhExec;
  readonly calls: (readonly string[])[];
} {
  const calls: (readonly string[])[] = [];
  const exec: GhExec = (args) => {
    calls.push(args);
    return handler(args);
  };
  return { exec, calls };
}

const ok = (stdout: string): GhResult => ({ status: 0, stdout, stderr: '' });
const fail = (stderr: string): GhResult => ({ status: 1, stdout: '', stderr });

test('a listed read reports every issue by url, and the exact total', async () => {
  const { exec, calls } = scripted((args) =>
    args[1] === 'search/issues'
      ? ok(
          JSON.stringify({
            total_count: 1,
            items: [
              {
                number: 42,
                title: 'Fix login bug',
                body: 'Steps',
                html_url: 'https://github.com/acme/website/issues/42',
                updated_at: '2026-08-20T00:00:00Z',
              },
            ],
          }),
        )
      : fail(`unexpected call: ${args.join(' ')}`),
  );
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('acme/website');
  assert.equal(survey.outcome, 'listed');
  if (survey.outcome !== 'listed') return;
  assert.equal(survey.source, 'acme/website', 'the seam gives read no row id, so the locator stands in');
  assert.equal(survey.total, 1);
  assert.equal(survey.documents.length, 1);
  assert.equal(survey.documents[0]?.path, 'https://github.com/acme/website/issues/42');
  assert.equal(survey.documents[0]?.bytes, Buffer.byteLength('Fix login bug\n\nSteps', 'utf8'));
  assert.equal(calls.length, 1, 'a non-empty result needs no existence check');
  assert.ok(calls[0]?.includes('--method'));
  assert.ok(calls[0]?.includes('q=repo:acme/website is:issue'));
});

test('a malformed locator is refused before any call is made', async () => {
  const { exec, calls } = scripted(() => fail('should not be called'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('not-a-repo-locator');
  assert.equal(survey.outcome, 'unreachable');
  assert.equal(calls.length, 0);
});

test('a zero-result search that is genuinely an empty repository stays listed', async () => {
  const { exec } = scripted((args) => {
    if (args[1] === 'search/issues') return ok(JSON.stringify({ total_count: 0, items: [] }));
    if (args[1] === 'repos/acme/empty') return ok(JSON.stringify({ name: 'empty' }));
    return fail(`unexpected call: ${args.join(' ')}`);
  });
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('acme/empty');
  assert.equal(survey.outcome, 'listed');
  if (survey.outcome !== 'listed') return;
  assert.equal(survey.total, 0);
  assert.deepEqual(survey.documents, []);
});

test('a zero-result search for a repository that does not exist reads as unreachable, not as an empty read', async () => {
  const { exec } = scripted((args) => {
    if (args[1] === 'search/issues') return ok(JSON.stringify({ total_count: 0, items: [] }));
    if (args[1] === 'repos/acme/ghost') return fail('HTTP 404: Not Found');
    return fail(`unexpected call: ${args.join(' ')}`);
  });
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('acme/ghost');
  assert.equal(survey.outcome, 'unreachable');
  if (survey.outcome !== 'unreachable') return;
  assert.match(survey.reason, /404/);
});

test('a search failure is reported unreachable with gh\'s own reason', async () => {
  const { exec } = scripted(() => fail('HTTP 401: Bad credentials'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('acme/website');
  assert.equal(survey.outcome, 'unreachable');
  if (survey.outcome !== 'unreachable') return;
  assert.match(survey.reason, /401/);
});

test('a search response that is not the expected JSON shape is unreachable, not a crash', async () => {
  const { exec } = scripted(() => ok('not json'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const survey = await connector.read('acme/website');
  assert.equal(survey.outcome, 'unreachable');
});

test('apply files an issue titled and bodied from the proposal, and reports a fetchable receipt', async () => {
  const { exec, calls } = scripted((args) =>
    args[1] === 'repos/acme/website/issues'
      ? ok(JSON.stringify({ number: 7, html_url: 'https://github.com/acme/website/issues/7' }))
      : fail(`unexpected call: ${args.join(' ')}`),
  );
  const connector = createGitHubConnector({
    exec,
    resolveLocator: (source) => (source === 'src-1' ? 'acme/website' : null),
  });
  const report = await connector.apply({
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'fix the header',
    justification: 'note:n-1#L3',
    risk: 'low',
    proposedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(report.applied, true);
  assert.match(report.detail, /#7/);
  assert.match(report.detail, /issues\/7/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.includes('title=fix the header'));
  assert.ok(calls[0]?.some((a) => a.startsWith('body=fix the header')));
  assert.ok(calls[0]?.some((a) => a.includes('note:n-1#L3')), 'the justification travels with the change');
});

test('apply refuses without calling out when this connector has no repository for the source', async () => {
  const { exec, calls } = scripted(() => fail('should not be called'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => null });
  const report = await connector.apply({
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-none',
    change: 'x',
    justification: 'y',
    risk: 'low',
    proposedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(report.applied, false);
  assert.equal(calls.length, 0);
});

test('apply reports a failed create with gh\'s own reason, and never fabricates a receipt', async () => {
  const { exec } = scripted(() => fail('HTTP 422: Validation Failed'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => 'acme/website' });
  const report = await connector.apply({
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'x',
    justification: 'y',
    risk: 'low',
    proposedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(report.applied, false);
  assert.match(report.detail, /422/);
});

test('apply refuses a malformed resolved locator without calling out', async () => {
  const { exec, calls } = scripted(() => fail('should not be called'));
  const connector = createGitHubConnector({ exec, resolveLocator: () => 'not-a-locator' });
  const report = await connector.apply({
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'x',
    justification: 'y',
    risk: 'low',
    proposedAt: '2026-08-21T00:00:00.000Z',
  });
  assert.equal(report.applied, false);
  assert.equal(calls.length, 0);
});
