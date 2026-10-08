/**
 * tests/hosts/hooks.test.ts — the habits that keep work honest run without
 * the host model having to remember them: host reads are recorded from tool
 * results as readable text with the issue's address, unchecked factual
 * answers are sent back once, and the hooks are installed in the checkout's
 * machine-local settings, through the launcher, without disturbing a
 * person's other settings or hooks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSource } from '../../src/kernel/state/sources.ts';
import { listActivity } from '../../src/kernel/state/activity.ts';
import { jiraItemsIn, onPostTool, onSessionStart, onStop, readableText } from '../../src/hosts/hooks/handlers.ts';
import { currentManifest } from '../../src/kernel/source/manifest.ts';
import { installHooks, inspectHooks, HOOK_SETTINGS_PATH, SHARED_HOOK_SETTINGS_PATH } from '../../src/hosts/wiring/hooks.ts';
import { holdsSet, installClaudeLocal, uninstallClaudeLocal } from '../../src/hosts/wiring/claude-local.ts';
import { CHECKOUT_LAUNCHER, sterile, type SterileFixture } from '../harness/sterile.ts';
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

/** A git repository with a .claude directory, and the environment git runs in, all inside the sterile fixture. */
function checkout(fx: SterileFixture): { readonly root: string; readonly stateDir: string; readonly env: NodeJS.ProcessEnv } {
  const root = join(fx.root, 'repo');
  mkdirSync(join(root, '.claude'), { recursive: true });
  mkdirSync(join(fx.root, 'home'), { recursive: true });
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: join(fx.root, 'home'), GIT_CONFIG_NOSYSTEM: '1' };
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, env }).status, 0);
  return { root, stateDir: join(root, '.construct', 'state'), env };
}

/** A grounding hook as an earlier release wrote it into the shared file: this machine's Node and install, by absolute path. */
const committedHook = (event: string, matcher?: string) => ({
  ...(matcher ? { matcher } : {}),
  hooks: [{ type: 'command', command: `/opt/teammate/node/bin/node /opt/teammate/lib/node_modules/@geraldmaron/construct/bin/construct.mjs hook ${event} --client=claude-code --project=/opt/teammate/repo`, timeout: 20 }],
});

const AT = '2026-10-08T12:00:00.000Z';

test('the grounding hooks go into the checkout\'s machine-local settings and run through the launcher; Construct\'s old entries leave the shared file and the person\'s stay', () => {
  const fx = sterile();
  try {
    const { root, stateDir, env } = checkout(fx);
    const place = { checkout: root, stateDir };
    const shared = join(root, SHARED_HOOK_SETTINGS_PATH);
    const mine = { hooks: [{ type: 'command', command: 'say done' }] };
    writeFileSync(shared, `${JSON.stringify({ model: 'x', hooks: { PostToolUse: [committedHook('post-tool', '*')], Stop: [mine, committedHook('stop')], SessionStart: [committedHook('session-start')] } }, null, 2)}\n`);
    const before = inspectHooks(root, place);
    assert.equal(before.status, 'stale');
    assert.match(before.detail, /^\.claude\/settings\.json, the shared file, still holds 3 construct hook\(s\) that name one machine's Node and install; `construct init --client=claude-code` repairs them$/);

    const state = installHooks(root, { ...place, env, at: AT });
    assert.equal(state.status, 'installed', state.detail);
    assert.equal(state.path, join(root, '.claude', 'settings.local.json'));
    assert.match(state.detail, /moved 3 old construct hook\(s\) out of \.claude\/settings\.json$/);
    assert.deepEqual(JSON.parse(readFileSync(shared, 'utf8')), { model: 'x', hooks: { Stop: [mine] } }, 'the person\'s own Stop hook stays, and so do their settings');

    const local = JSON.parse(readFileSync(join(root, HOOK_SETTINGS_PATH), 'utf8')) as { hooks: Record<string, { matcher?: string; hooks: { command: string; timeout: number }[] }[]> };
    assert.deepEqual(Object.keys(local.hooks), ['PostToolUse', 'Stop', 'SessionStart']);
    assert.equal(local.hooks.PostToolUse![0]!.matcher, '*');
    for (const [hostEvent, event] of [['PostToolUse', 'post-tool'], ['Stop', 'stop'], ['SessionStart', 'session-start']] as const) {
      assert.equal(local.hooks[hostEvent]!.length, 1, hostEvent);
      const { command, timeout } = local.hooks[hostEvent]![0]!.hooks[0]!;
      assert.equal(timeout, 20);
      assert.ok(command.startsWith(`/bin/sh -c 'l='\\''${join(stateDir, 'launcher')}'\\''; `), command);
      assert.ok(command.endsWith(`; "$n" "$c" hook ${event} --client=claude-code 2>/dev/null; exit 0'`), command);
      assert.ok(!command.includes(process.execPath) && !command.includes('--project'), 'Node and the install are found through the launcher, and the project from the event');
    }
    assert.equal(readFileSync(join(stateDir, 'launcher'), 'utf8'), `${process.execPath}\n${CHECKOUT_LAUNCHER}\n`);
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: root, env }).status, 0, 'the machine-local file stays out of git');
    const ran = spawnSync('/bin/sh', ['-c', local.hooks.Stop![0]!.hooks[0]!.command], { cwd: root, env, input: JSON.stringify({ cwd: root }), encoding: 'utf8' });
    assert.equal(ran.status, 0, 'the hook runs as the host runs it, and exits 0');
  } finally {
    fx.cleanup();
  }
});

test('re-running the install is byte-identical, and init repairs an entry that differs or a launcher that names a Node that is gone', () => {
  const fx = sterile();
  try {
    const { root, stateDir, env } = checkout(fx);
    const place = { checkout: root, stateDir };
    const local = join(root, HOOK_SETTINGS_PATH);
    writeFileSync(local, `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, null, 2)}\n`);
    assert.equal(installHooks(root, { ...place, env, at: AT }).status, 'installed');
    const files = [local, join(stateDir, 'launcher'), join(stateDir, 'installed.json'), join(fx.root, 'repo', '.git', 'info', 'exclude')];
    const first = files.map((f) => readFileSync(f, 'utf8'));
    assert.equal(installHooks(root, { ...place, env, at: '2026-10-09T12:00:00.000Z' }).status, 'installed');
    assert.deepEqual(files.map((f) => readFileSync(f, 'utf8')), first, 'nothing changes on a second run');
    const settings = JSON.parse(first[0]!) as { permissions: unknown; hooks: Record<string, { hooks: { command: string }[] }[]> };
    assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
    assert.equal(settings.hooks.Stop!.length, 2);
    assert.equal(settings.hooks.Stop![0]!.hooks[0]!.command, 'echo mine', 'the person\'s hook stays first');

    const launcher = join(stateDir, 'launcher');
    writeFileSync(launcher, `/no/such/node\n${CHECKOUT_LAUNCHER}\n`);
    const gone = inspectHooks(root, place);
    assert.equal(gone.status, 'stale');
    assert.match(gone.detail, /the launcher names \/no\/such\/node, which no longer exists here; `construct init --client=claude-code` repairs them/);
    rmSync(launcher);
    assert.match(inspectHooks(root, place).detail, /the launcher .*launcher is missing, so the hooks cannot find Node/);
    assert.equal(installHooks(root, { ...place, env, at: AT }).status, 'installed');

    const edited = JSON.parse(readFileSync(local, 'utf8')) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
    edited.hooks.PostToolUse![0]!.hooks[0]!.command = `/opt/old/node /opt/old/construct.mjs hook post-tool --client=claude-code --project=${root}`;
    writeFileSync(local, JSON.stringify(edited, null, 2));
    const differs = inspectHooks(root, place);
    assert.equal(differs.status, 'stale');
    assert.match(differs.detail, /\.claude\/settings\.local\.json has construct hooks that differ from what init writes now/);
    assert.equal(installHooks(root, { ...place, env, at: AT }).status, 'installed');
    assert.equal(readFileSync(local, 'utf8'), first[0], 'the stale entry is rewritten, not kept beside a new one');

    writeFileSync(local, '{ not json');
    writeFileSync(join(root, SHARED_HOOK_SETTINGS_PATH), JSON.stringify({ hooks: { Stop: [committedHook('stop')] } }));
    const sharedBefore = readFileSync(join(root, SHARED_HOOK_SETTINGS_PATH), 'utf8');
    assert.equal(installHooks(root, { ...place, env, at: AT }).status, 'broken');
    assert.equal(readFileSync(local, 'utf8'), '{ not json', 'a file that is not JSON is never rewritten');
    assert.equal(readFileSync(join(root, SHARED_HOOK_SETTINGS_PATH), 'utf8'), sharedBefore, 'and the shared file keeps its hooks until the new ones are in place');
    assert.equal(inspectHooks(join(root, 'nowhere'), { checkout: join(root, 'nowhere'), stateDir }).status, 'absent');
  } finally {
    fx.cleanup();
  }
});

test('one writer: removing one set of hooks leaves the other and the ignore line, and removing the last puts the file and the ignore list back', () => {
  const fx = sterile();
  try {
    const { root, stateDir, env } = checkout(fx);
    const local = join(root, HOOK_SETTINGS_PATH);
    const exclude = join(root, '.git', 'info', 'exclude');
    const excludeNow = (): string | null => (existsSync(exclude) ? readFileSync(exclude, 'utf8') : null);
    const excludeBefore = excludeNow();
    installClaudeLocal(root, stateDir, env, AT, 'grounding');
    installClaudeLocal(root, stateDir, env, AT, 'coordination');
    const both = readFileSync(local, 'utf8');
    assert.ok(holdsSet(both, 'grounding') && holdsSet(both, 'coordination'));
    assert.equal(installClaudeLocal(root, stateDir, env, AT, 'grounding').changed, false, 'a set already in place changes nothing');
    assert.deepEqual(uninstallClaudeLocal(root, stateDir, 'grounding'), ['removed the grounding hooks', `${local} keeps the claude-code hook pack, and stays out of git`]);
    const left = readFileSync(local, 'utf8');
    assert.ok(!holdsSet(left, 'grounding') && holdsSet(left, 'coordination'));
    assert.notEqual(excludeNow(), excludeBefore);
    assert.deepEqual(uninstallClaudeLocal(root, stateDir, 'grounding'), ['no grounding hooks are installed in this checkout']);
    assert.deepEqual(uninstallClaudeLocal(root, stateDir, 'coordination'), ['removed the claude-code hook pack', `restored ${local} as it was`]);
    assert.equal(existsSync(local), false, 'there was no file before Construct wrote one');
    assert.equal(excludeNow(), excludeBefore);

    // A change someone made between two of Construct's writes outlives Construct's hooks.
    installClaudeLocal(root, stateDir, env, AT, 'grounding');
    writeFileSync(local, `${JSON.stringify({ ...JSON.parse(readFileSync(local, 'utf8')), model: 'opus' }, null, 2)}\n`);
    installClaudeLocal(root, stateDir, env, AT, 'coordination');
    uninstallClaudeLocal(root, stateDir, 'coordination');
    uninstallClaudeLocal(root, stateDir, 'grounding');
    assert.deepEqual(JSON.parse(readFileSync(local, 'utf8')), { model: 'opus' });
  } finally {
    fx.cleanup();
  }
});

test('a machine-local settings file git tracks is never written, because what is written there would be committed', () => {
  const fx = sterile();
  try {
    const { root, stateDir, env } = checkout(fx);
    const local = join(root, HOOK_SETTINGS_PATH);
    const shared = join(root, SHARED_HOOK_SETTINGS_PATH);
    writeFileSync(local, `${JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }, null, 2)}\n`);
    writeFileSync(shared, `${JSON.stringify({ hooks: { Stop: [committedHook('stop')] } }, null, 2)}\n`);
    const gitEnv = { ...env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
    assert.equal(spawnSync('git', ['add', '.claude'], { cwd: root, env: gitEnv }).status, 0);
    assert.equal(spawnSync('git', ['commit', '-q', '-m', 'tracked'], { cwd: root, env: gitEnv }).status, 0);
    const before = [readFileSync(local, 'utf8'), readFileSync(shared, 'utf8')];

    const state = installHooks(root, { checkout: root, stateDir, env, at: AT });
    assert.equal(state.status, 'broken');
    assert.match(state.detail, /settings\.local\.json is tracked by git, so hooks written there would be committed; Construct will not edit it; left untouched$/);
    assert.deepEqual([readFileSync(local, 'utf8'), readFileSync(shared, 'utf8')], before, 'neither file changes');
    assert.throws(() => installClaudeLocal(root, stateDir, env, AT, 'coordination'), /tracked by git/);
    assert.equal(readFileSync(local, 'utf8'), before[0]);
    assert.equal(existsSync(join(root, '.git', 'info', 'exclude')) && readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8').includes('/.claude/settings.local.json'), false, 'no ignore line that would do nothing for a tracked file');
  } finally {
    fx.cleanup();
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

test('review findings: a search hit then a full read of the same ticket keeps the fuller text and is not an edit', async () => {
  const fx = brokerFixture();
  try {
    const at = fx.ctx.now();
    addSource(fx.broker.store, { id: 'jira-p', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at });
    // First seen in a search: no updated time, a thin object.
    onPostTool(fx.broker, { tool_name: 'mcp__atlassian__searchJiraIssues', tool_response: { issues: [{ key: 'PLAT-9', fields: { summary: 'Events' } }] } });
    // Then read in full, with its version.
    const full = fx.broker.sources.reportRead('jira-p', { items: [{ ref: 'PLAT-9', updatedAt: '2026-09-29T10:00:00Z', text: 'Decision: v1 is gated to the Enterprise plan.' }], partial: true }, at, () => fx.ctx.nextId('snap'));
    assert.deepEqual(full.changes?.modified ?? [], [], 'a passing sighting gaining its version is not an edit');
    // Then the same version again through a search with less text, then a get-issue with more.
    fx.broker.sources.reportRead('jira-p', { items: [{ ref: 'PLAT-9', updatedAt: '2026-09-29T10:00:00Z', text: 'Events' }], partial: true }, at, () => fx.ctx.nextId('snap'));
    const richer = fx.broker.sources.reportRead('jira-p', { items: [{ ref: 'PLAT-9', updatedAt: '2026-09-29T10:00:00Z', text: 'Decision: v1 is gated to the Enterprise plan. Revisit Pro in Q3.' }], partial: true }, at, () => fx.ctx.nextId('snap'));
    assert.deepEqual(richer.changes?.modified ?? [], [], 'fuller text for the same version is recorded, not called a change');
    assert.equal((richer.staleDeliverables ?? []).length, 0);
    const ans = await call(fx, 'check_answer', { answer: 'Pro is revisited in Q3.', citations: [{ ref: 'PLAT-9', excerpt: 'Revisit Pro in Q3' }] });
    assert.equal(ans.ok, true, JSON.stringify(ans.problems));
  } finally {
    fx.cleanup();
  }
});

/** A Jira Cloud issue as the REST API returns it: an ADF description, marks on some runs, a REST self link. */
const adfIssue = {
  key: 'PLAT-101',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
  fields: {
    summary: 'Platform events',
    updated: '2026-09-29T10:00:00Z',
    description: {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'Sam said "ship v1 to ' },
          { type: 'text', text: 'Enterprise', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' only" on the call.' },
        ] },
        { type: 'bulletList', content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revisit Pro in Q3.' }] }] },
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: 'First line' }, { type: 'hardBreak' }, { type: 'text', text: 'second line', marks: [{ type: 'link', attrs: { href: 'https://x.example' } }] }] },
      ],
    },
  },
};

test('readable text keeps what a person reads in an issue: quotes, line breaks, and rich text without its markup', async () => {
  const text = readableText(adfIssue);
  assert.match(text, /Sam said "ship v1 to Enterprise only" on the call\./, 'inline runs with marks join into one line, quotes intact');
  assert.match(text, /\nRevisit Pro in Q3\.\n/, 'a block goes on its own line');
  assert.match(text, /First line\nsecond line/);
  for (const markup of ['paragraph', 'strong', 'bulletList', 'hardBreak', 'https://x.example', '{', '\\"']) assert.ok(!text.includes(markup), `no ${markup} in the text`);
  assert.equal(readableText(JSON.stringify({ a: 'one', b: [2, { c: 'three' }], d: true, e: null })), 'one\n2\nthree', 'JSON inside a string is opened; booleans and nulls are not words');

  const fx = brokerFixture();
  try {
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    onPostTool(fx.broker, { tool_name: 'mcp__atlassian__getJiraIssue', tool_response: { content: [{ type: 'text', text: JSON.stringify(adfIssue) }] } });
    const ans = await call(fx, 'check_answer', { answer: 'Sam wants v1 on Enterprise only.', citations: [{ ref: 'PLAT-101', excerpt: 'Sam said "ship v1 to Enterprise only" on the call' }] });
    assert.equal(ans.ok, true, JSON.stringify(ans.problems));
  } finally {
    fx.cleanup();
  }
});

test('an issue is recorded under the browse page its REST self link names, unless it gives its own address', () => {
  const [item] = jiraItemsIn({ issues: [adfIssue] }, 'PLAT');
  assert.equal(item!.url, 'https://acme.atlassian.net/browse/PLAT-101');
  const server = jiraItemsIn({ key: 'PLAT-7', self: 'https://jira.acme.internal/jira/rest/api/2/issue/77', fields: { summary: 'x' } }, 'PLAT');
  assert.equal(server[0]!.url, 'https://jira.acme.internal/jira/browse/PLAT-7', 'a server under a context path keeps it');
  assert.equal(jiraItemsIn({ key: 'PLAT-8', url: 'https://acme.atlassian.net/browse/PLAT-8?focus=1', self: 'https://acme.atlassian.net/rest/api/3/issue/8' }, 'PLAT')[0]!.url, 'https://acme.atlassian.net/browse/PLAT-8?focus=1');
  assert.equal(jiraItemsIn({ key: 'PLAT-9', self: 'not a link' }, 'PLAT')[0]!.url, undefined);
  assert.equal(jiraItemsIn({ key: 'PLAT-10', webUrl: 'https://me:secret@acme.atlassian.net/browse/PLAT-10' }, 'PLAT')[0]!.url, undefined, 'an address carrying credentials is not kept');

  const fx = brokerFixture();
  try {
    addSource(fx.broker.store, { id: 'jira-plat', kind: 'jira', locator: 'PLAT', purpose: 'tickets', authorityLevel: 'authoritative', sensitivity: 'internal', canRead: true, canWrite: false, at: fx.ctx.now() });
    onPostTool(fx.broker, { tool_name: 'mcp__atlassian__getJiraIssue', tool_response: adfIssue });
    assert.equal(currentManifest(fx.broker.store, 'jira-plat')!.find((e) => e.ref === 'PLAT-101')?.url, 'https://acme.atlassian.net/browse/PLAT-101');
  } finally {
    fx.cleanup();
  }
});
