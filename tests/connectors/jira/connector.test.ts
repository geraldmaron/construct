/**
 * tests/connectors/jira/connector.test.ts — what the Jira connector reads,
 * what it refuses to write, and what it hands back when it does write.
 *
 * The properties held here: a project's issues become read rows a person can
 * audit, a listing the cap cut short says so rather than reading as the whole
 * project, and a request Jira refused becomes an unreachable row carrying
 * Jira's own words. On the write side, nothing reaches Jira without a
 * decision row behind it — an undecided change, a rejected one, and a
 * high-risk one riding a workspace's standing consent all leave the transport
 * untouched — and nothing this connector sends can carry a field the
 * authority map says the tracker owns.
 *
 * Every response comes from tests/connectors/jira/fixtures.ts, transcribed
 * from Atlassian's published description of the API. Nothing here has spoken
 * to a Jira site.
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
  proposeDocEdit,
  proposeWrite,
  setWriteConsent,
  sourceReadsFor,
} from '../../../src/kernel/store/sources.ts';
import type { WriteProposal } from '../../../src/kernel/store/sources.ts';
import { recordRunSourceReads } from '../../../src/kernel/run/sourcereads.ts';
import { mappedFieldsByAuthority } from '../../../src/kernel/tracker/authority.ts';
import { createJiraConnector } from '../../../src/connectors/jira/connector.ts';
import { ISSUE_PATH, SEARCH_PATH } from '../../../src/connectors/jira/pin.ts';
import type { JiraCall, JiraResult } from '../../../src/connectors/jira/api.ts';
import {
  PROJECT,
  SITE,
  UNAUTHORIZED,
  issue,
  recordingTransport,
  searchPage,
} from './fixtures.ts';

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

function seed(store: Store, proposal: Partial<WriteProposal> = {}): WriteProposal {
  addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
  const row: WriteProposal = {
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'the release runner needs its own health check before the deploy step',
    justification: 'deliverable:t-1#L4',
    risk: 'high',
    proposedAt: AT,
    ...proposal,
  };
  proposeWrite(store, row);
  return row;
}

function connectorOver(handler: (call: JiraCall) => JiraResult): {
  connector: ReturnType<typeof createJiraConnector>;
  calls: JiraCall[];
} {
  const recording = recordingTransport(handler);
  return {
    calls: recording.calls,
    connector: createJiraConnector({ transport: recording.transport, source: 'src-1', site: SITE }),
  };
}

function fieldsOf(call: JiraCall): Record<string, unknown> {
  return ((call.body ?? {}) as { fields?: Record<string, unknown> }).fields ?? {};
}

test('a project’s issues become read rows a person can audit', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    const { connector, calls } = connectorOver(() =>
      searchPage([
        issue('PROJ-1', 'Order entry fails when selecting supplier', 'Occurs on all orders.'),
        issue('PROJ-2', 'Deploy step times out'),
      ]),
    );

    const survey = await connector.read(PROJECT);
    assert.equal(survey.outcome, 'listed');
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const rows = sourceReadsFor(store, 'run-1');
    assert.deepEqual(
      rows.map((r) => [r.descriptor, r.coverage]),
      [
        ['PROJ-1', 'complete'],
        ['PROJ-2', 'complete'],
      ],
    );
    assert.match(rows[0]!.detail, /^\d+ bytes$/);
    // The search names the fields it wants: the default is ids only, and a
    // listing of ids would record every issue as nothing read and call it
    // complete.
    assert.deepEqual(((calls[0]!.body ?? {}) as { fields?: unknown }).fields, ['summary', 'description']);
    assert.equal(calls[0]!.path, SEARCH_PATH);
  });
});

test('a listing the cap cut short is recorded as a partial read, not as the whole project', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    const recording = recordingTransport((call) =>
      call.path === SEARCH_PATH
        ? searchPage([issue('PROJ-1', 'first'), issue('PROJ-2', 'second')], 'page-2')
        : { status: 200, body: { count: 97 } },
    );
    const connector = createJiraConnector({
      transport: recording.transport,
      source: 'src-1',
      site: SITE,
      cap: 1,
    });

    const survey = await connector.read(PROJECT);
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const rows = sourceReadsFor(store, 'run-1');
    assert.equal(rows.length, 2);
    assert.equal(rows[1]!.coverage, 'partial');
    assert.match(rows[1]!.detail, /listed 1 of 97 documents/);
  });
});

test('an estimate at or below what was listed cannot close a gap the listing witnessed', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    const recording = recordingTransport((call) =>
      call.path === SEARCH_PATH
        ? searchPage([issue('PROJ-1', 'first'), issue('PROJ-2', 'second')], 'page-2')
        : { status: 200, body: { count: 1 } },
    );
    const connector = createJiraConnector({
      transport: recording.transport,
      source: 'src-1',
      site: SITE,
      cap: 1,
    });

    const survey = await connector.read(PROJECT);
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const rows = sourceReadsFor(store, 'run-1');
    assert.equal(rows[1]?.coverage, 'partial', 'the remainder is still on the record');
    assert.match(rows[1]!.detail, /listed 1 of 2 documents/);
  });
});

test('an issue that came back with no key is part of the remainder, not silently absent', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    const recording = recordingTransport((call) =>
      call.path === SEARCH_PATH
        ? searchPage([issue('PROJ-1', 'first'), { id: '10002', fields: { summary: 'nameless' } }])
        : { status: 200, body: { count: 2 } },
    );
    const connector = createJiraConnector({ transport: recording.transport, source: 'src-1', site: SITE });

    recordRunSourceReads(store, 'run-1', [await connector.read(PROJECT)], AT);

    const rows = sourceReadsFor(store, 'run-1');
    assert.deepEqual(rows.map((r) => r.coverage), ['complete', 'partial']);
    assert.match(rows[1]!.detail, /listed 1 of 2 documents/);
  });
});

test('a refused request reads as unreachable, carrying the words Jira used', async () => {
  await withStore(async (store) => {
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    const { connector } = connectorOver(() => UNAUTHORIZED);

    const survey = await connector.read(PROJECT);
    recordRunSourceReads(store, 'run-1', [survey], AT);

    const rows = sourceReadsFor(store, 'run-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.coverage, 'unreachable');
    assert.match(rows[0]!.detail, /401.*must be authenticated/);
  });
});

test('a locator that is not a project key asks Jira nothing', async () => {
  const { connector, calls } = connectorOver(() => searchPage([]));
  const survey = await connector.read('proj-1" OR project = "OTHER');
  assert.equal(survey.outcome, 'unreachable');
  assert.equal(calls.length, 0, 'an unvalidated locator never reaches a query');
});

test('an undecided change reaches no request at all', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 201, body: { key: 'PROJ-9' } }));
    seed(store);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'refused');
    assert.equal(calls.length, 0);
    assert.equal(decisionOf(store, 'p-1'), null);
  });
});

test('a rejected change is not retried by the surface that can also carry it out', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 201, body: { key: 'PROJ-9' } }));
    seed(store);
    decideProposal(store, 'p-1', 'rejected', 'the team decided otherwise', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'refused');
    assert.equal(calls.length, 0);
  });
});

test('standing consent does not carry a high-risk change into someone else’s tracker', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 201, body: { key: 'PROJ-9' } }));
    seed(store);
    setWriteConsent(store, 'acme', true, AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'refused');
    assert.equal(calls.length, 0);
  });
});

test('an approved change is filed as an issue and hands back a receipt', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({
      status: 201,
      body: { id: '10009', key: 'PROJ-9', self: `${SITE}/rest/api/3/issue/10009` },
    }));
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'applied');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, 'POST');
    assert.equal(calls[0]!.path, ISSUE_PATH);

    const fields = fieldsOf(calls[0]!);
    assert.deepEqual(fields.project, { key: PROJECT });
    assert.deepEqual(fields.issuetype, { name: 'Task' });
    assert.equal(fields.summary, 'the release runner needs its own health check before the deploy step');
    assert.equal(
      (fields.description as { type?: string }).type,
      'doc',
      'a v3 description is a document, never a string',
    );

    const decision = decisionOf(store, 'p-1');
    assert.equal(decision?.verdict, 'applied');
    assert.match(decision!.reason, /PROJ-9/);
    assert.match(decision!.reason, new RegExp(`${SITE}/browse/PROJ-9`));
  });
});

test('nothing sent can carry a field the authority map says the tracker owns', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 201, body: { key: 'PROJ-9' } }));
    seed(store, {
      change: 'reassign the release runner work and set its priority to highest, labels included',
    });
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    await connector.apply(store, 'p-1', LATER);

    const sent = Object.keys(fieldsOf(calls[0]!));
    for (const owned of mappedFieldsByAuthority().tracker) {
      assert.ok(!sent.includes(owned), `${owned} is the tracker's and was not sent`);
    }
  });
});

test('a change that leads with an issue key edits that issue’s description and never its summary', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 204, body: null }));
    seed(store, { change: 'PROJ-14: the deploy step now waits for the health check' });
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'applied');
    assert.equal(calls[0]!.method, 'PUT');
    assert.equal(calls[0]!.path, `${ISSUE_PATH}/PROJ-14`);

    const fields = fieldsOf(calls[0]!);
    assert.deepEqual(Object.keys(fields), ['description']);
    assert.equal(
      (fields.description as { type?: string }).type,
      'doc',
      'a v3 description is a document, never a string',
    );
  });
});

test('a change naming an issue in another project is not carried anywhere', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 204, body: null }));
    seed(store, { change: 'OTHER-3: the deploy step now waits for the health check' });
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'unappliable');
    assert.equal(calls.length, 0);
    assert.notEqual(decisionOf(store, 'p-1')?.verdict, 'applied');
  });
});

test('a change Jira refused stays approved and unapplied, with the reason Jira gave', async () => {
  await withStore(async (store) => {
    const { connector } = connectorOver(() => ({
      status: 400,
      body: { errorMessages: [], errors: { issuetype: 'Specify an issue type' } },
    }));
    seed(store);
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'unappliable');
    assert.match(outcome.outcome === 'unappliable' ? outcome.reason : '', /Specify an issue type/);
    assert.equal(decisionOf(store, 'p-1')?.verdict, 'approved');
  });
});

test('a change bound for a source that is not a Jira project is refused, not guessed at', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 201, body: { key: 'PROJ-9' } }));
    addSource(store, { id: 'src-2', workspace: 'acme', kind: 'github', locator: 'acme/app', addedAt: AT });
    seed(store, { source: 'src-2' });
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'unappliable');
    assert.equal(calls.length, 0);
  });
});

test('a proposed edit to the words inside a document is refused rather than guessed at', async () => {
  await withStore(async (store) => {
    const { connector, calls } = connectorOver(() => ({ status: 204, body: null }));
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: PROJECT, addedAt: AT });
    proposeDocEdit(store, {
      id: 'p-1',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'PROJ-14: redline the deploy paragraph',
      justification: 'deliverable:t-1#L4',
      risk: 'high',
      proposedAt: AT,
    }, {
      kind: 'redline',
      document: 'PROJ-14',
      anchor: 'the deploy step waits for nothing',
      proposed: 'the deploy step waits for the health check',
      recordedAt: AT,
    });
    decideProposal(store, 'p-1', 'approved', 'agreed in review', AT);

    const outcome = await connector.apply(store, 'p-1', LATER);
    assert.equal(outcome.outcome, 'unappliable');
    assert.equal(calls.length, 0);
  });
});
