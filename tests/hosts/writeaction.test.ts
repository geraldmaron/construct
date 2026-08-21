/**
 * tests/hosts/writeaction.test.ts — the host-layer WriteActionProposer.
 *
 * Fail-open on purpose, mirroring hosts/namer.ts's THROW convention in
 * reverse: a namer throws so naming.ts can state the degradation, but a
 * proposer that fails on one finding must not cost the rest of the
 * deliverable its extraction, so every failure mode here resolves to null
 * rather than throwing — proposeActionsWithModel reads null as "nobody
 * decided this one" and the row falls through to the keyword read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionChoicePrompt, createHostActionProposer } from '../../src/hosts/writeaction.ts';
import { WRITE_ACTIONS } from '../../src/kernel/run/proposals.ts';
import type { Finding } from '../../src/kernel/run/proposals.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

const FINDING: Finding = {
  kind: 'what-follows',
  text: 'File a ticket for the identity gap before the launch review.',
  line: 16,
  citation: 'deliverable:t-1#L16',
};

function host(result: Partial<HostResult>): HostAdapter {
  return {
    name: 'stub',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (): Promise<HostResult> => ({
      id: 'x',
      status: 'ok',
      output: null,
      error: null,
      ...result,
    }),
  };
}

test('the prompt names every write action and carries the finding verbatim', () => {
  const prompt = actionChoicePrompt(FINDING);
  for (const action of WRITE_ACTIONS) assert.ok(prompt.includes(action), action);
  assert.ok(prompt.includes(FINDING.text));
});

test('a clean reply proposes the action it names', async () => {
  const proposer = createHostActionProposer(host({ output: { text: '{"action":"create"}' } }));
  assert.equal(await proposer(FINDING), 'create');
});

test('a fenced reply and mixed case are both read', async () => {
  const proposer = createHostActionProposer(
    host({ output: { text: '```json\n{"action":"LABEL"}\n```' } }),
  );
  assert.equal(await proposer(FINDING), 'label');
});

test('a non-ok status resolves to null rather than throwing', async () => {
  const proposer = createHostActionProposer(host({ status: 'error', output: { text: '{"action":"create"}' } }));
  assert.equal(await proposer(FINDING), null);
});

test('no text resolves to null', async () => {
  const proposer = createHostActionProposer(host({ output: { text: '   ' } }));
  assert.equal(await proposer(FINDING), null);
});

test('unparseable JSON resolves to null rather than throwing', async () => {
  const proposer = createHostActionProposer(host({ output: { text: 'not json at all' } }));
  assert.equal(await proposer(FINDING), null);
});

test('an action outside WRITE_ACTIONS resolves to null rather than being trusted', async () => {
  const proposer = createHostActionProposer(host({ output: { text: '{"action":"delete-everything"}' } }));
  assert.equal(await proposer(FINDING), null);
});

test('a host that throws resolves to null rather than propagating', async () => {
  const throwing: HostAdapter = {
    ...host({}),
    invoke: async () => {
      throw new Error('the transport died');
    },
  };
  const proposer = createHostActionProposer(throwing);
  assert.equal(await proposer(FINDING), null);
});
