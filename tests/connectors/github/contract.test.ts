/**
 * tests/connectors/github/contract.test.ts — the properties the seam design
 * promises, proven against the real kernel rather than trusted on the
 * connector's own say-so: a read this connector produces becomes an
 * auditable source_reads row, and an apply it can perform never runs ahead
 * of a decision row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import {
  addSource,
  decideProposal,
  decisionOf,
  proposeWrite,
  setWriteConsent,
  sourceReadsFor,
} from '../../../src/kernel/store/sources.ts';
import { recordRunSourceReads } from '../../../src/kernel/run/sourcereads.ts';
import { applyProposal } from '../../../src/kernel/run/apply.ts';
import { createGitHubConnector } from '../../../src/connectors/github/connector.ts';
import type { GhExec, GhResult } from '../../../src/connectors/github/connector.ts';

const AT = '2026-08-21T00:00:00.000Z';
const LATER = '2026-08-21T01:00:00.000Z';

function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  return fn(store).finally(() => {
    store.close();
    fixture.cleanup();
  });
}

const ok = (stdout: string): GhResult => ({ status: 0, stdout, stderr: '' });

function countingExec(answer: GhResult): { readonly exec: GhExec; readonly count: () => number } {
  let calls = 0;
  const exec: GhExec = () => {
    calls += 1;
    return answer;
  };
  return { exec, count: () => calls };
}

test('a read this connector produces is recorded as an auditable source_reads row', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/website', addedAt: AT });
    const exec: GhExec = (args) =>
      args[1] === 'search/issues'
        ? ok(
            JSON.stringify({
              total_count: 1,
              items: [
                {
                  number: 5,
                  title: 'Broken link',
                  body: 'on the homepage',
                  html_url: 'https://github.com/acme/website/issues/5',
                  updated_at: AT,
                },
              ],
            }),
          )
        : ok('{}');
    const connector = createGitHubConnector({ exec, resolveLocator: () => null });
    // The connector only ever sees the bare locator, so the caller that
    // knows the source's real row id substitutes it before recording —
    // exactly the seam wrinkle connector.ts's read documents.
    const survey = { ...(await connector.read('acme/website')), source: 'src-1' };
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const reads = sourceReadsFor(store, 'run-1');
    assert.equal(reads.length, 1);
    assert.equal(reads[0]?.source, 'src-1');
    assert.equal(reads[0]?.coverage, 'complete');
    assert.equal(reads[0]?.descriptor, 'https://github.com/acme/website/issues/5');
    assert.match(reads[0]?.detail ?? '', /bytes/);
  });
});

test('an unreachable read is recorded as unreachable, never absorbed as silence', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/ghost', addedAt: AT });
    const exec: GhExec = (args) =>
      args[1] === 'search/issues'
        ? ok(JSON.stringify({ total_count: 0, items: [] }))
        : { status: 1, stdout: '', stderr: 'HTTP 404: Not Found' };
    const connector = createGitHubConnector({ exec, resolveLocator: () => null });
    const survey = { ...(await connector.read('acme/ghost')), source: 'src-1' };
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const reads = sourceReadsFor(store, 'run-1');
    assert.equal(reads.length, 1);
    assert.equal(reads[0]?.coverage, 'unreachable');
    assert.match(reads[0]?.detail ?? '', /404/);
  });
});

test('an apply this connector can perform never fires without a decision row', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/website', addedAt: AT });
    proposeWrite(store, {
      id: 'p-1',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'file a bug about the broken link',
      justification: 'note:n-1#L1',
      risk: 'low',
      proposedAt: AT,
    });
    const { exec, count } = countingExec(
      ok(JSON.stringify({ number: 9, html_url: 'https://github.com/acme/website/issues/9' })),
    );
    const connector = createGitHubConnector({
      exec,
      resolveLocator: (source) => (source === 'src-1' ? 'acme/website' : null),
    });

    const undecided = await applyProposal(store, connector.apply, 'p-1', LATER);
    assert.equal(undecided.outcome, 'refused');
    assert.equal(count(), 0, 'an undecided proposal never reaches gh');

    decideProposal(store, 'p-1', 'rejected', 'not now', AT);
    const rejected = await applyProposal(store, connector.apply, 'p-1', LATER);
    assert.equal(rejected.outcome, 'refused');
    assert.equal(count(), 0, 'a rejected proposal never reaches gh either');
  });
});

test('a high-risk proposal never rides standing consent through to gh', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/website', addedAt: AT });
    setWriteConsent(store, 'acme', true, AT);
    proposeWrite(store, {
      id: 'p-high',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'close every open issue',
      justification: 'note:n-1#L2',
      risk: 'high',
      proposedAt: AT,
    });
    const { exec, count } = countingExec(ok('{}'));
    const connector = createGitHubConnector({ exec, resolveLocator: () => 'acme/website' });

    const result = await applyProposal(store, connector.apply, 'p-high', LATER);
    assert.equal(result.outcome, 'refused');
    assert.equal(count(), 0);
  });
});

test('an approved proposal reaches gh exactly once and is recorded applied from its own answer', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/website', addedAt: AT });
    proposeWrite(store, {
      id: 'p-1',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'file a bug about the broken link',
      justification: 'note:n-1#L1',
      risk: 'low',
      proposedAt: AT,
    });
    decideProposal(store, 'p-1', 'approved', 'yes, file it', AT);
    const { exec, count } = countingExec(
      ok(JSON.stringify({ number: 9, html_url: 'https://github.com/acme/website/issues/9' })),
    );
    const connector = createGitHubConnector({
      exec,
      resolveLocator: (source) => (source === 'src-1' ? 'acme/website' : null),
    });

    const result = await applyProposal(store, connector.apply, 'p-1', LATER);
    assert.equal(result.outcome, 'applied');
    assert.equal(count(), 1);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'applied');
    assert.match(result.outcome === 'applied' ? result.detail : '', /issues\/9/);
  });
});

test('a gh failure leaves the proposal approved and unapplied, never silently recorded as landed', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'github', locator: 'acme/website', addedAt: AT });
    proposeWrite(store, {
      id: 'p-1',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'file a bug about the broken link',
      justification: 'note:n-1#L1',
      risk: 'low',
      proposedAt: AT,
    });
    decideProposal(store, 'p-1', 'approved', 'yes, file it', AT);
    const exec: GhExec = () => ({ status: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' });
    const connector = createGitHubConnector({
      exec,
      resolveLocator: (source) => (source === 'src-1' ? 'acme/website' : null),
    });

    const result = await applyProposal(store, connector.apply, 'p-1', LATER);
    assert.equal(result.outcome, 'unappliable');
    assert.match(result.outcome === 'unappliable' ? result.reason : '', /401/);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'approved', 'the honest state is unchanged');
  });
});
