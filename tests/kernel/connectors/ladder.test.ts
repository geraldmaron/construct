/**
 * tests/kernel/connectors/ladder.test.ts — the ladder as a real selection
 * function: host MCP checked before the connector, the connector checked
 * before an honest refusal, and every one of those three outcomes named on
 * the work log for both a read and a write. The ordering tests reuse plain
 * fakes (seam.test.ts's own style); the "matching connector" tests run the
 * real Jira and GitHub connectors against a scripted transport, so the
 * fallback rung is proven against the actual connector code, not only a
 * type-compatible stand-in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import type { Store } from '../../../src/kernel/store/open.ts';
import { addSource, decideProposal, proposeWrite } from '../../../src/kernel/store/sources.ts';
import type { SourceKind } from '../../../src/kernel/store/sources.ts';
import { readWorkLog } from '../../../src/kernel/store/worklog.ts';
import {
  applyThroughLadder,
  surveyThroughLadder,
  TRACKER_READ_ACTION,
  TRACKER_WRITE_ACTION,
} from '../../../src/kernel/connectors/ladder.ts';
import type { ReadLadder, WriteLadder } from '../../../src/kernel/connectors/ladder.ts';
import type { ApplyReport } from '../../../src/kernel/run/apply.ts';
import type { SourceSurvey } from '../../../src/kernel/run/sourcereads.ts';
import { createJiraConnector } from '../../../src/connectors/jira/connector.ts';
import { issue, recordingTransport, searchPage, PROJECT, SITE } from '../../connectors/jira/fixtures.ts';
import { createGitHubConnector } from '../../../src/connectors/github/connector.ts';
import type { GhExec, GhResult } from '../../../src/connectors/github/connector.ts';

const AT = '2026-08-21T00:00:00.000Z';
const LOG = { run: 'run-1', role: 'change-applier', at: AT };

function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  return fn(store).finally(() => {
    store.close();
    fixture.cleanup();
  });
}

function seedApproved(store: Store, sourceKind: SourceKind = 'jira'): void {
  const locator = sourceKind === 'github' ? 'acme/website' : PROJECT;
  addSource(store, { id: 'src-1', workspace: 'acme', kind: sourceKind, locator, addedAt: AT });
  proposeWrite(store, {
    id: 'p-1',
    workspace: 'acme',
    run: 'run-1',
    source: 'src-1',
    change: 'move PROJ-14 target date to Q4',
    justification: 'note:n-1#L3',
    risk: 'low',
    proposedAt: AT,
  });
  decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
}

function fakeApplier(report: ApplyReport, calls: string[], label: string) {
  return async (): Promise<ApplyReport> => {
    calls.push(label);
    return report;
  };
}

function fakeReader(survey: SourceSurvey, calls: string[], label: string) {
  return async (): Promise<SourceSurvey> => {
    calls.push(label);
    return survey;
  };
}

// ---------------------------------------------------------------------------
// Order enforced: host MCP before the connector, the connector before
// refusal — for a write.
// ---------------------------------------------------------------------------

test('a write reaches host MCP first when both rungs are present, and the connector is never asked', async () => {
  await withStore(async (store) => {
    seedApproved(store);
    const calls: string[] = [];
    const ladder: WriteLadder = {
      hostApply: fakeApplier({ applied: true, detail: 'moved via host' }, calls, 'host'),
      connectorApply: fakeApplier({ applied: true, detail: 'moved via connector' }, calls, 'connector'),
    };
    const result = await applyThroughLadder(store, ladder, 'p-1', LOG);
    assert.equal(result.path, 'host-mcp');
    assert.equal(result.evidence, 'reported');
    assert.equal(result.outcome.outcome, 'applied');
    assert.equal(result.outcome.outcome === 'applied' ? result.outcome.detail : '', 'moved via host');
    assert.deepEqual(calls, ['host'], 'the connector rung is never invoked once host MCP answers');
  });
});

test('a write falls back to the connector when no host MCP rung is present', async () => {
  await withStore(async (store) => {
    seedApproved(store);
    const calls: string[] = [];
    const ladder: WriteLadder = {
      hostApply: null,
      connectorApply: fakeApplier({ applied: true, detail: 'moved via connector' }, calls, 'connector'),
    };
    const result = await applyThroughLadder(store, ladder, 'p-1', LOG);
    assert.equal(result.path, 'connector');
    assert.equal(result.evidence, 'witnessed');
    assert.equal(result.outcome.outcome, 'applied');
    assert.deepEqual(calls, ['connector']);
  });
});

test('a write is refused honestly, not silently, when neither rung is present', async () => {
  await withStore(async (store) => {
    seedApproved(store);
    const ladder: WriteLadder = { hostApply: null, connectorApply: null };
    const result = await applyThroughLadder(store, ladder, 'p-1', LOG);
    assert.equal(result.path, 'refused');
    assert.equal(result.evidence, null);
    assert.equal(result.outcome.outcome, 'refused');
    // States plainly what was missing — no host tool, no configured
    // connector — rather than a generic failure.
    const reason = result.outcome.outcome === 'refused' ? result.outcome.reason : '';
    assert.match(reason, /no host MCP surface/);
    assert.match(reason, /no connector/);
  });
});

// ---------------------------------------------------------------------------
// Same order, for a read.
// ---------------------------------------------------------------------------

const LISTED: SourceSurvey = {
  source: 'whatever-the-reader-set',
  locator: PROJECT,
  outcome: 'listed',
  documents: [{ path: 'PROJ-1', bytes: 10 }],
  total: 1,
};

test('a read reaches host MCP first when both rungs are present, and the connector is never asked', async () => {
  await withStore(async (store) => {
    const calls: string[] = [];
    const ladder: ReadLadder = {
      hostRead: fakeReader(LISTED, calls, 'host'),
      connectorRead: fakeReader(LISTED, calls, 'connector'),
    };
    const result = await surveyThroughLadder(store, ladder, { source: 'src-1', locator: PROJECT }, LOG);
    assert.equal(result.path, 'host-mcp');
    assert.equal(result.evidence, 'reported');
    assert.equal(result.survey.outcome, 'listed');
    assert.deepEqual(calls, ['host']);
    // The declared source id wins over whatever the reader itself set.
    assert.equal(result.survey.source, 'src-1');
  });
});

test('a read falls back to the connector when no host MCP rung is present', async () => {
  await withStore(async (store) => {
    const calls: string[] = [];
    const ladder: ReadLadder = { hostRead: null, connectorRead: fakeReader(LISTED, calls, 'connector') };
    const result = await surveyThroughLadder(store, ladder, { source: 'src-1', locator: PROJECT }, LOG);
    assert.equal(result.path, 'connector');
    assert.equal(result.evidence, 'witnessed');
    assert.deepEqual(calls, ['connector']);
  });
});

test('a read is refused honestly, not silently, when neither rung is present', async () => {
  await withStore(async (store) => {
    const ladder: ReadLadder = { hostRead: null, connectorRead: null };
    const result = await surveyThroughLadder(store, ladder, { source: 'src-1', locator: PROJECT }, LOG);
    assert.equal(result.path, 'refused');
    assert.equal(result.evidence, null);
    assert.equal(result.survey.outcome, 'unreachable');
    const reason = result.survey.outcome === 'unreachable' ? result.survey.reason : '';
    assert.match(reason, /no host MCP surface/);
    assert.match(reason, /no connector/);
  });
});

test('a reader that throws is recorded as an unreachable survey, not an uncaught exception', async () => {
  await withStore(async (store) => {
    const ladder: ReadLadder = {
      hostRead: null,
      connectorRead: async () => {
        throw new Error('socket hang up');
      },
    };
    const result = await surveyThroughLadder(store, ladder, { source: 'src-1', locator: PROJECT }, LOG);
    assert.equal(result.path, 'connector');
    assert.equal(result.survey.outcome, 'unreachable');
    const reason = result.survey.outcome === 'unreachable' ? result.survey.reason : '';
    assert.match(reason, /socket hang up/);
  });
});

// ---------------------------------------------------------------------------
// Every read and write is named on the work log, whichever path answered.
// ---------------------------------------------------------------------------

test('a write logs which path answered, win or refuse', async () => {
  await withStore(async (store) => {
    seedApproved(store);
    await applyThroughLadder(
      store,
      { hostApply: fakeApplier({ applied: true, detail: 'moved it' }, [], 'host'), connectorApply: null },
      'p-1',
      LOG,
    );
    const [entry] = readWorkLog(store, 'run-1').filter((e) => e.action === TRACKER_WRITE_ACTION);
    assert.ok(entry, 'a work-log entry was appended for the write');
    const detail = entry.detail as Record<string, unknown>;
    assert.equal(detail.path, 'host-mcp');
    assert.equal(detail.evidence, 'reported');
    assert.equal(detail.outcome, 'applied');
    assert.equal(detail.proposal, 'p-1');
  });
});

test('a refused write still logs the refusal, not a silent no-op', async () => {
  await withStore(async (store) => {
    seedApproved(store);
    await applyThroughLadder(store, { hostApply: null, connectorApply: null }, 'p-1', LOG);
    const entries = readWorkLog(store, 'run-1').filter((e) => e.action === TRACKER_WRITE_ACTION);
    assert.equal(entries.length, 1, 'a refusal is recorded exactly once, never dropped');
    const detail = entries[0]?.detail as Record<string, unknown>;
    assert.equal(detail.path, 'refused');
    assert.equal(detail.evidence, null);
    assert.equal(detail.outcome, 'refused');
  });
});

test('a read logs which path answered, win or refuse', async () => {
  await withStore(async (store) => {
    await surveyThroughLadder(
      store,
      { hostRead: null, connectorRead: fakeReader(LISTED, [], 'connector') },
      { source: 'src-1', locator: PROJECT },
      LOG,
    );
    const [entry] = readWorkLog(store, 'run-1').filter((e) => e.action === TRACKER_READ_ACTION);
    assert.ok(entry, 'a work-log entry was appended for the read');
    const detail = entry.detail as Record<string, unknown>;
    assert.equal(detail.path, 'connector');
    assert.equal(detail.evidence, 'witnessed');
    assert.equal(detail.outcome, 'listed');
    assert.equal(detail.source, 'src-1');
  });
});

// ---------------------------------------------------------------------------
// The connector rung run for real: Jira for a read, GitHub for a write,
// each driven through the ladder exactly as a caller with no host MCP tool
// would drive them.
// ---------------------------------------------------------------------------

test('the connector rung surveys a real Jira project through the ladder', async () => {
  await withStore(async (store) => {
    const recording = recordingTransport(() =>
      searchPage([issue('PROJ-1', 'Order entry fails', 'Occurs on all orders.')]),
    );
    const jira = createJiraConnector({ transport: recording.transport, source: 'src-1', site: SITE });
    const result = await surveyThroughLadder(
      store,
      { hostRead: null, connectorRead: jira.read },
      { source: 'src-1', locator: PROJECT },
      LOG,
    );
    assert.equal(result.path, 'connector');
    assert.equal(result.evidence, 'witnessed');
    assert.equal(result.survey.outcome, 'listed');
    if (result.survey.outcome !== 'listed') return;
    assert.equal(result.survey.documents.length, 1);
    assert.equal(result.survey.documents[0]?.path, 'PROJ-1');
    assert.equal(result.survey.source, 'src-1');
    const [entry] = readWorkLog(store, 'run-1').filter((e) => e.action === TRACKER_READ_ACTION);
    assert.equal((entry?.detail as Record<string, unknown>).path, 'connector');
  });
});

function scriptedGh(handler: (args: readonly string[]) => GhResult): { exec: GhExec; calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const exec: GhExec = (args) => {
    calls.push(args);
    return handler(args);
  };
  return { exec, calls };
}

test('the connector rung applies a real GitHub write through the ladder, with an auditable receipt', async () => {
  await withStore(async (store) => {
    seedApproved(store, 'github');
    const { exec, calls } = scriptedGh((args) =>
      args[1] === 'repos/acme/website/issues'
        ? { status: 0, stdout: JSON.stringify({ number: 7, html_url: 'https://github.com/acme/website/issues/7' }), stderr: '' }
        : { status: 1, stdout: '', stderr: `unexpected call: ${args.join(' ')}` },
    );
    const github = createGitHubConnector({
      exec,
      resolveLocator: (source) => (source === 'src-1' ? 'acme/website' : null),
    });
    const result = await applyThroughLadder(
      store,
      { hostApply: null, connectorApply: github.apply },
      'p-1',
      LOG,
    );
    assert.equal(result.path, 'connector');
    assert.equal(result.evidence, 'witnessed');
    assert.equal(result.outcome.outcome, 'applied');
    const detail = result.outcome.outcome === 'applied' ? result.outcome.detail : '';
    assert.match(detail, /#7/);
    assert.match(detail, /issues\/7/);
    assert.equal(calls.length, 1);
    const [entry] = readWorkLog(store, 'run-1').filter((e) => e.action === TRACKER_WRITE_ACTION);
    const logged = entry?.detail as Record<string, unknown>;
    assert.equal(logged.path, 'connector');
    assert.equal(logged.evidence, 'witnessed');
    assert.match(String(logged.landed), /#7/);
  });
});
