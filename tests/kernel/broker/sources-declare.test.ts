/**
 * tests/kernel/broker/sources-declare.test.ts — a session declares a system
 * the person named, so what it reads there can be reported and cited: the
 * source stays in this machine's state, is treated as confidential, settles
 * nothing, and never reaches the committed file. Directory and git sources
 * stay with the person, and the person can commit a declared source later.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { createMcpHandler } from '../../../src/hosts/mcp/server.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { findEntityByRef } from '../../../src/kernel/state/graph.ts';
import { getSource } from '../../../src/kernel/state/sources.ts';
import { validateSourcesFile } from '../../../src/kernel/project/sources-file.ts';
import { run } from '../../../src/cli/index.ts';
import { capture } from '../../cli/support.ts';
import { brokerFixture, type BrokerFixture } from './support.ts';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
async function call(fx: BrokerFixture, name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const t = tool(name);
  return (await t.run(fx.broker, t.validate(record(args)))) as Record<string, any>;
}

type ToolResult = { error?: unknown; result: { isError?: boolean; structuredContent: Record<string, any> } };
async function mcpCall(handle: ReturnType<typeof createMcpHandler>, id: number, args: Record<string, unknown>): Promise<ToolResult> {
  return (await handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'sources', arguments: args } })) as ToolResult;
}

function problem(fn: () => unknown): ToolInputError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ToolInputError, String(error));
    return error;
  }
  assert.fail('expected a ToolInputError');
}

test('a declared source is local, confidential, informative, and on the record as declared by the assistant', async () => {
  const fx = brokerFixture();
  try {
    const committed = readFileSync(fx.broker.layout.sourcesFile);
    const declared = await call(fx, 'sources', { action: 'declare', id: 'jira', kind: 'jira', locator: 'PROJ', purpose: 'where the team tracks platform work' });
    assert.equal(declared.declared, true);
    assert.deepEqual(declared.source, { id: 'jira', kind: 'jira', origin: 'local', sensitivity: 'confidential', authority: 'informative' });
    assert.match(declared.next, /Report what you read from it with sources action report/);
    assert.match(declared.next, /construct source add/);

    const listed = (await call(fx, 'sources', { action: 'list' })) as unknown as { source: { id: string; origin: string; sensitivity: string; authorityLevel: string; locator: string | null; purpose: string; canWrite: boolean } }[];
    const jira = listed.find((s) => s.source.id === 'jira');
    assert.ok(jira, 'the declared source is listed');
    assert.equal(jira.source.origin, 'local');
    assert.equal(jira.source.sensitivity, 'confidential');
    assert.equal(jira.source.authorityLevel, 'informative');
    assert.equal(jira.source.locator, 'PROJ');
    assert.equal(jira.source.purpose, 'where the team tracks platform work');
    assert.equal(jira.source.canWrite, false);

    const events = listActivity(fx.broker.store).filter((e) => e.kind === 'source.declared');
    assert.equal(events.length, 1);
    assert.equal(events[0]!.actor, fx.broker.actor);
    assert.deepEqual(events[0]!.payload, { sourceId: 'jira', kind: 'jira', by: 'relayed' });
    assert.ok(findEntityByRef(fx.broker.store, 'system', 'source:jira'), 'the source stands in the context graph like any other');

    const unnamed = await call(fx, 'sources', { action: 'declare', id: 'datadog', kind: 'other' });
    assert.equal(getSource(fx.broker.store, 'datadog')?.purpose, 'named by the person; declared by your assistant in this session');
    assert.equal(unnamed.source.kind, 'other');

    const again = await call(fx, 'sources', { action: 'declare', id: 'jira', kind: 'other' });
    assert.equal(again.declared, false);
    assert.equal(again.already, true);
    assert.equal(again.source.source.kind, 'jira', 'a second declare changes nothing and shows the source as it stands');
    assert.equal(listActivity(fx.broker.store).filter((e) => e.kind === 'source.declared').length, 2);

    assert.deepEqual(readFileSync(fx.broker.layout.sourcesFile), committed, 'nothing a session declares reaches the committed file');
  } finally {
    fx.cleanup();
  }
});

test('directory and git sources stay with the person, and wrong declare input names its field', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    for (const [n, kind] of [[1, 'directory'], [2, 'git']] as const) {
      const r = await mcpCall(handle, n, { action: 'declare', id: 'notes', kind, locator: '/tmp/notes' });
      assert.equal(r.error, undefined, 'wrong input is not a protocol error');
      assert.equal(r.result.isError, true);
      assert.equal(r.result.structuredContent.field, 'kind');
      assert.deepEqual(r.result.structuredContent.allowed, ['github', 'jira', 'docs', 'hris', 'other']);
      assert.match(r.result.structuredContent.error, /declared by the person with construct source add, because it lets Construct read files itself/);
    }
    assert.equal(getSource(fx.broker.store, 'notes'), null, 'nothing is declared');

    const declare = tool('sources');
    assert.equal(problem(() => declare.validate({ action: 'declare', kind: 'jira' })).field, 'id');
    const badId = problem(() => declare.validate({ action: 'declare', id: 'Slack Workspace', kind: 'other' }));
    assert.equal(badId.field, 'id');
    assert.equal(badId.example, 'slack-workspace', 'the example is the id the name would take');
    const noKind = problem(() => declare.validate({ action: 'declare', id: 'slack' }));
    assert.equal(noKind.field, 'kind');
    assert.deepEqual(noKind.allowed, ['github', 'jira', 'docs', 'hris', 'other']);
    const badLocator = problem(() => declare.validate({ action: 'declare', id: 'jira', kind: 'jira', locator: 'proj-1' }));
    assert.equal(badLocator.field, 'locator');
    assert.equal(badLocator.example, 'PROJ');
    assert.match(badLocator.message, /project key/);
    const secret = problem(() => declare.validate({ action: 'declare', id: 'wiki', kind: 'other', locator: 'https://me:hunter2@wiki.example.com/space' }));
    assert.equal(secret.field, 'locator');
    assert.match(secret.message, /carries credentials/);
    assert.doesNotMatch(secret.message, /hunter2/);
    assert.equal(problem(() => declare.validate({ action: 'declare', id: 'wiki', kind: 'other', purpose: 'x'.repeat(201) })).field, 'purpose');
    assert.equal(problem(() => declare.validate({ action: 'report', id: 'jira', kind: 'jira', items: [{ ref: 'PROJ-1' }] })).field, 'kind', 'declare-only inputs are refused on other actions');
  } finally {
    fx.cleanup();
  }
});

test('a report on an undeclared id names the declare remedy, and the same report after declaring is recorded and citable', async () => {
  const fx = brokerFixture();
  try {
    const handle = createMcpHandler('interactive', fx.broker);
    const items = [{ ref: 'PROJ-101', title: 'Retry policy', updatedAt: '2026-08-21', text: 'Retries back off over 24 hours.' }];
    const undeclared = await mcpCall(handle, 1, { action: 'report', id: 'jira', items });
    assert.equal(undeclared.error, undefined);
    assert.equal(undeclared.result.isError, true);
    assert.equal(undeclared.result.structuredContent.field, 'id');
    assert.equal(undeclared.result.structuredContent.error, 'no source "jira" is declared; declare it with sources action declare (id, kind), then report again');
    assert.deepEqual(undeclared.result.structuredContent.allowed, []);
    const show = await mcpCall(handle, 2, { action: 'show', id: 'jira' });
    assert.equal(show.result.isError, true);
    assert.equal(show.result.structuredContent.field, 'id');

    const declared = await mcpCall(handle, 3, { action: 'declare', id: 'jira', kind: 'jira', locator: 'PROJ' });
    assert.equal(declared.result.isError, undefined);
    const reported = await mcpCall(handle, 4, { action: 'report', id: 'jira', items });
    assert.equal(reported.result.isError, undefined);
    assert.equal(reported.result.structuredContent.outcome, 'changed');
    assert.equal(reported.result.structuredContent.sourceId, 'jira');

    const checked = await call(fx, 'check_answer', { answer: 'Retries back off over 24 hours.', citations: [{ ref: 'PROJ-101', excerpt: 'back off over 24 hours' }] });
    assert.deepEqual(checked.evidence, { witnessed: 0, reported: 1, unresolved: 0 }, 'what was reported from a declared source is citable, as the assistant\'s report');
    const unknown = await mcpCall(handle, 5, { action: 'report', id: 'confluence', items });
    assert.deepEqual(unknown.result.structuredContent.allowed, ['jira'], 'the error names the sources that are declared');
  } finally {
    fx.cleanup();
  }
});

test('the systems a person names in one request can all be declared and reported from chat', async () => {
  const fx = brokerFixture();
  try {
    const committed = readFileSync(fx.broker.layout.sourcesFile);
    const systems = [
      { id: 'jira', kind: 'jira', ref: 'PROJ-7' },
      { id: 'confluence', kind: 'docs', locator: 'confluence:space:ENG', ref: 'page-42' },
      { id: 'datadog', kind: 'other', ref: 'dashboard/api-latency' },
      { id: 'slack', kind: 'other', ref: 'C024BE91L/p1690000000' },
      { id: 'github', kind: 'github', locator: 'acme/platform', ref: 'acme/platform#12' },
      { id: 'notion', kind: 'docs', ref: 'architecture-notes' },
      { id: 'web', kind: 'other', ref: 'https://example.com/post' },
    ];
    for (const s of systems) {
      const d = await call(fx, 'sources', { action: 'declare', id: s.id, kind: s.kind, ...(s.locator ? { locator: s.locator } : {}) });
      assert.equal(d.declared, true, s.id);
      const r = await call(fx, 'sources', { action: 'report', id: s.id, items: [{ ref: s.ref, updatedAt: '2026-09-15', text: `what ${s.id} says` }] });
      assert.equal(r.outcome, 'changed', s.id);
    }
    const local = fx.broker.sources.list().filter((s) => s.origin === 'local').map((s) => s.id).sort();
    assert.deepEqual(local, systems.map((s) => s.id).sort());
    assert.deepEqual(readFileSync(fx.broker.layout.sourcesFile), committed);
  } finally {
    fx.cleanup();
  }
});

test('the person commits a declared source with construct source add, and what was read from it carries over', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'jira', kind: 'jira', locator: 'PROJ' });
    await call(fx, 'sources', { action: 'report', id: 'jira', items: [{ ref: 'PROJ-101', updatedAt: '2026-08-21', text: 'Retries back off over 24 hours.' }] });

    const wrongKind = await capture(() => run(['source', 'add', 'jira', '--kind=other', '--purpose=tickets'], fx.ctx));
    assert.equal(wrongKind.code, 1);
    assert.match(wrongKind.err, /jira exists on this machine as a jira source/);
    assert.deepEqual(validateSourcesFile(JSON.parse(readFileSync(fx.broker.layout.sourcesFile, 'utf8')), 'sources.json').sources, [], 'a refused commit writes nothing');

    const add = await capture(() => run(['source', 'add', 'jira', '--kind=jira', '--purpose=work tracking'], fx.ctx));
    assert.equal(add.code, 0, add.err);
    assert.match(add.out, /declared source jira \(jira\) in \.construct\/sources\.json; what was already read from it on this machine carries over/);
    const file = validateSourcesFile(JSON.parse(readFileSync(fx.broker.layout.sourcesFile, 'utf8')), 'sources.json');
    assert.deepEqual(file.sources.map((s) => [s.id, s.kind, s.locator, s.sensitivity]), [['jira', 'jira', null, 'confidential']], 'the local locator stays out of the committed file, and the sensitivity is not lowered unasked');
    const s = getSource(fx.broker.store, 'jira')!;
    assert.equal(s.origin, 'declared');
    assert.equal(s.sensitivity, 'confidential');
    assert.equal(s.purpose, 'work tracking', 'the committed declaration governs');
    assert.equal(s.locator, 'PROJ');
    const checked = await call(fx, 'check_answer', { answer: 'Retries back off over 24 hours.', citations: [{ ref: 'PROJ-101' }] });
    assert.deepEqual(checked.evidence, { witnessed: 0, reported: 1, unresolved: 0 });
  } finally {
    fx.cleanup();
  }
});
