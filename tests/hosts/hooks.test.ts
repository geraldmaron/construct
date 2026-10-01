/**
 * tests/hosts/hooks.test.ts — the habits that keep work honest run without
 * the host model having to remember them: host reads are recorded from tool
 * results, unchecked factual answers are sent back once, and the hooks are
 * installed without disturbing a person's other settings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSource } from '../../src/kernel/state/sources.ts';
import { listActivity } from '../../src/kernel/state/activity.ts';
import { jiraItemsIn, onPostTool, onSessionStart, onStop } from '../../src/hosts/hooks/handlers.ts';
import { installHooks, inspectHooks, HOOK_SETTINGS_PATH } from '../../src/hosts/wiring/hooks.ts';
import { TOOLS } from '../../src/kernel/broker/tools.ts';
import { record } from '../../src/kernel/broker/definition.ts';
import { brokerFixture } from '../kernel/broker/support.ts';

const call = async (fx: ReturnType<typeof brokerFixture>, name: string, args: Record<string, unknown>) => {
  const t = TOOLS.find((x) => x.name === name)!;
  return (await t.run(fx.broker, t.validate(record(args)))) as any;
};

const jiraResponse = {
  content: [{ type: 'text', text: JSON.stringify({ issues: [
    { key: 'PLAT-101', fields: { summary: 'Platform events', updated: '2026-09-29T10:00:00Z', description: 'Decision: v1 is gated to the Enterprise plan.' } },
    { key: 'OTHER-1', fields: { summary: 'not ours' } },
  ] }) }],
};

test('Jira issues are found in a connector response, including JSON inside text content, and only for the declared project', () => {
  const items = jiraItemsIn(jiraResponse, 'PLAT');
  assert.deepEqual(items.map((i) => i.ref), ['PLAT-101']);
  assert.equal(items[0]!.title, 'Platform events');
  assert.equal(items[0]!.updatedAt, '2026-09-29T10:00:00Z');
});

test('a host tool that returns tracker items records them as a host read, without the model reporting anything', async () => {
  const fx = brokerFixture();
  try {
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    const before = await call(fx, 'check_answer', { answer: 'v1 is Enterprise only.', citations: [{ ref: 'PLAT-101' }] });
    assert.equal(before.evidence.unresolved, 1, 'a never-read host source is not taken on the host\'s word');
    const r = onPostTool(fx.broker, { tool_name: 'mcp__atlassian__searchJiraIssues', tool_response: jiraResponse });
    assert.deepEqual(r.reported, { 'jira-plat': 1 });
    const after = await call(fx, 'check_answer', { answer: 'v1 is Enterprise only.', citations: [{ ref: 'PLAT-101', excerpt: 'gated to the Enterprise plan' }] });
    assert.equal(after.ok, true, JSON.stringify(after.problems));
    assert.deepEqual(onPostTool(fx.broker, { tool_name: 'mcp__construct__sources', tool_response: jiraResponse }).reported, {}, 'Construct\'s own tools are not host reads');
    assert.ok(listActivity(fx.broker.store, {}).some((a) => a.kind === 'hook.read_reported'));
  } finally {
    fx.cleanup();
  }
});

function transcript(dir: string, entries: unknown[]): string {
  const p = join(dir, 't.jsonl');
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n'));
  return p;
}

test('an answer that names project facts without check_answer is sent back once; checked, gated, or fact-free replies are not', () => {
  const fx = brokerFixture();
  const dir = mkdtempSync(join(tmpdir(), 'construct-transcript-'));
  try {
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    const prompt = { type: 'user', message: { content: 'where are we on webhooks?' } };
    const says = (text: string, tools: string[] = []) => ({ type: 'assistant', message: { content: [...tools.map((name) => ({ type: 'tool_use', name })), { type: 'text', text }] } });
    const unchecked = transcript(dir, [prompt, says('PLAT-101 gates v1 to Enterprise.')]);
    const verdict = onStop(fx.broker, { transcript_path: unchecked });
    assert.equal(verdict?.decision, 'block');
    assert.match(verdict!.reason, /PLAT-101/);
    assert.equal(onStop(fx.broker, { transcript_path: unchecked, stop_hook_active: true }), null, 'never twice: a hook must not loop');
    assert.equal(onStop(fx.broker, { transcript_path: transcript(dir, [prompt, says('PLAT-101 gates v1.', ['mcp__construct__check_answer'])]) }), null);
    assert.equal(onStop(fx.broker, { transcript_path: transcript(dir, [prompt, says('Drafted the PRD from PLAT-101.', ['mcp__construct__submit_work'])]) }), null);
    assert.equal(onStop(fx.broker, { transcript_path: transcript(dir, [prompt, says('Sure, here is a haiku about autumn.')]) }), null);
    // A file name that is not one of the project's declared sources is not a project fact.
    assert.equal(onStop(fx.broker, { transcript_path: transcript(dir, [prompt, says('Add it to package.json and see the README.md of the dependency.')]) }), null);
    // An earlier, already-answered turn does not count against the current one.
    assert.equal(onStop(fx.broker, { transcript_path: transcript(dir, [prompt, says('PLAT-101 gates v1.'), { type: 'user', message: { content: 'thanks, now a haiku' } }, says('Leaves fall.')]) }), null);
    assert.equal(onStop({ ...fx.broker, policy: { hostReads: 'require', answerCheck: 'off' } }, { transcript_path: unchecked }), null);
  } finally {
    fx.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session start says what waits and which sources only the host can read', async () => {
  const fx = brokerFixture();
  try {
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    assert.match(await onSessionStart(fx.broker), /jira-plat/);
  } finally {
    fx.cleanup();
  }
});

test('hooks install into Claude Code settings additively, once, and never over a file that is not JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-hooks-'));
  try {
    mkdirSync(join(root, '.claude'));
    const path = join(root, HOOK_SETTINGS_PATH);
    writeFileSync(path, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
    assert.equal(installHooks(root).status, 'installed');
    assert.equal(installHooks(root).status, 'installed');
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(settings.model, 'x');
    assert.equal(settings.hooks.Stop.length, 2, 'the person\'s own Stop hook stays, Construct\'s is added once');
    assert.equal(settings.hooks.PostToolUse.length, 1);
    writeFileSync(path, '{ not json');
    assert.equal(installHooks(root).status, 'broken');
    assert.equal(readFileSync(path, 'utf8'), '{ not json');
    assert.equal(inspectHooks(join(root, 'nowhere')).status, 'absent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the hook command never wedges a session: bad input or no project still exits 0', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const bin = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'construct-nohook-'));
  try {
    for (const [event, input] of [['stop', '{ not json'], ['post-tool', JSON.stringify({ tool_name: 'x', tool_response: {} })], ['session-start', '']] as const) {
      const r = spawnSync(process.execPath, [bin, 'hook', event], { cwd: dir, input, encoding: 'utf8' });
      assert.equal(r.status, 0, `${event}: ${r.stderr}`);
      assert.equal(r.stdout, '', `${event} says nothing when there is nothing to say`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review findings: a thinner view of the same ticket is not a change, and underscore project keys match', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.ctx.now();
    addSource(fx.broker.store, { id: 'jira-pa', kind: 'jira', locator: 'PLAT_A', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    const full = { issues: [{ key: 'PLAT_A-7', fields: { summary: 'Events', updated: '2026-09-29T10:00:00Z', description: 'Decision: Enterprise only.' } }] };
    assert.deepEqual(jiraItemsIn(full, 'PLAT_A').map((i) => i.ref), ['PLAT_A-7']);
    assert.deepEqual(jiraItemsIn({ key: 'PLATA-7' }, 'PLAT_A'), [], 'the underscore is part of the key, not noise to strip');
    onPostTool(fx.broker, { tool_name: 'mcp__atlassian__getJiraIssue', tool_response: full });
    // A later search returns the same ticket with fewer fields and no updated time.
    const thin = onPostTool(fx.broker, { tool_name: 'mcp__atlassian__searchJiraIssues', tool_response: { issues: [{ key: 'PLAT_A-7', fields: { summary: 'Events' } }] } });
    assert.deepEqual(thin.reported, { 'jira-pa': 1 });
    const same = fx.broker.sources.reportRead('jira-pa', { items: [{ ref: 'PLAT_A-7', updatedAt: '2026-09-29T10:00:00Z', text: '{"key":"PLAT_A-7"}' }], partial: true }, at, () => fx.ctx.nextId('snap'));
    assert.equal(same.outcome, 'unchanged', 'same updated time, thinner text: unchanged');
    const ans = await call(fx, 'check_answer', { answer: 'Enterprise only.', citations: [{ ref: 'PLAT_A-7', excerpt: 'Decision: Enterprise only' }] });
    assert.equal(ans.ok, true, 'the fuller text recorded first is kept for checking quotes');
    const edited = fx.broker.sources.reportRead('jira-pa', { items: [{ ref: 'PLAT_A-7', updatedAt: '2026-09-30T08:00:00Z', text: 'Decision: Pro at launch.' }], partial: true }, at, () => fx.ctx.nextId('snap'));
    assert.deepEqual(edited.changes?.modified, ['PLAT_A-7'], 'a new updated time is a change');
  } finally {
    fx.cleanup();
  }
});
