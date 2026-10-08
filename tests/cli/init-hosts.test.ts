/**
 * tests/cli/init-hosts.test.ts — plain init connects the agent host it finds,
 * or the ones the person picks at their own terminal, and plants the
 * operational skill in the project where those hosts read it. When nothing is
 * connected it says so and names the command that connects one, and doctor
 * fails until then. Re-running init repairs an earlier release's host file
 * and hooks. Every PATH and HOME is the sandbox's own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { run } from '../../src/cli/index.ts';
import type { CliContext } from '../../src/cli/context.ts';
import { CLIENT_WIRINGS } from '../../src/hosts/wiring/clients.ts';
import { capture, sandbox, type Sandbox } from './support.ts';

const SHIPPED_SKILL = readFileSync(new URL('../../skills/construct/SKILL.md', import.meta.url));

/** The sandbox context with fake host commands ahead of its sterile PATH. */
function withHosts(box: Sandbox, ...binaries: string[]): CliContext {
  const bin = join(box.home, 'host-bin');
  mkdirSync(bin, { recursive: true });
  for (const name of binaries) writeFileSync(join(bin, name), '#!/bin/sh\n', { mode: 0o755 });
  return { ...box.ctx, env: { ...box.ctx.env, PATH: `${bin}:${box.ctx.env.PATH!}` } };
}

function plantedIn(box: Sandbox, dir: string): boolean {
  const path = join(box.cwd, dir, 'construct', 'SKILL.md');
  return existsSync(path) && Buffer.compare(readFileSync(path), SHIPPED_SKILL) === 0;
}

function firstRun(client: string): readonly string[] {
  return CLIENT_WIRINGS.find((w) => w.id === client)!.firstRun;
}

interface Doctor { readonly healthy: boolean; readonly checks: readonly { name: string; ok: boolean; detail: string }[] }

async function doctor(ctx: CliContext): Promise<Doctor> {
  return JSON.parse((await capture(() => run(['doctor', '--json'], ctx))).out) as Doctor;
}

test('with no host named, detected, or installed, init writes nothing outside .construct, says nothing is connected, and doctor fails with the fix', async () => {
  const box = sandbox();
  try {
    const before = readdirSync(box.cwd).sort();
    const init = await capture(() => run(['init'], box.ctx));
    assert.equal(init.code, 0, init.err);
    assert.deepEqual(readdirSync(box.cwd).sort(), [...before, '.construct', '.gitignore'].sort());
    assert.match(init.out, /host: not connected\. No agent host was named or detected here\.\n {4}no agent host found on this machine\nNext: run `construct init --client=<host>` for the host you use here; until then no agent session can reach Construct\./);
    assert.doesNotMatch(init.out, /answer the questions in your agent session|talk in your agent session/);
    const dry = await capture(() => run(['init', '--dry-run'], box.ctx));
    assert.match(dry.out, /host: would wire none\. No agent host was named or detected here\./);

    const sick = await capture(() => run(['doctor'], box.ctx));
    assert.equal(sick.code, 1);
    assert.match(sick.out, /FAIL host-wiring: no host wired, so no agent session can reach Construct; no agent host found on this machine; `construct init --client=<host>` wires one/);
  } finally {
    box.cleanup();
  }
});

test('the one host installed here is wired, its skill planted in the project, and its one-time steps printed', async () => {
  const box = sandbox();
  try {
    const ctx = withHosts(box, 'claude');
    const init = await capture(() => run(['init'], ctx));
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /host: claude-code wired \(\.mcp\.json starts `construct serve`; the only agent host found on this machine: claude on PATH \(.*host-bin\/claude\)\)/);
    assert.match(init.out, /skill: planted at .*\.claude\/skills\/construct \(installed\)/);
    assert.match(init.out, /Next, in Claude Code:/);
    firstRun('claude-code').forEach((step, i) => assert.ok(init.out.includes(`  ${String(i + 1)}. ${step}\n`), step));
    assert.match(init.out, / 4\. Ask for what you want in your own words\. It will ask the 3 setup question\(s\) when they change the work\./);
    assert.ok(existsSync(join(box.cwd, '.mcp.json')));
    assert.ok(plantedIn(box, '.claude/skills'));
    assert.equal(existsSync(join(box.home, '.claude')), false, 'no personal copy is planted');
    const health = await doctor(ctx);
    assert.equal(health.healthy, true, JSON.stringify(health.checks.filter((c) => !c.ok)));
    assert.match(health.checks.find((c) => c.name === 'operational-skill')!.detail, /^current in .*\.claude\/skills \(read by claude-code\)/);
  } finally {
    box.cleanup();
  }
});

test('several hosts off a terminal: both are named as choices and neither is wired', async () => {
  const box = sandbox();
  try {
    const ctx: CliContext = { ...withHosts(box, 'claude', 'codex'), terminal: { interactive: false, agentAncestor: null } };
    const init = await capture(() => run(['init'], ctx));
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /host: not connected\. No agent host was named or detected here\.\n {4}found on this machine: claude-code \(claude on PATH .*\), codex \(codex on PATH .*\)\nNext: run `construct init --client=<host>`/);
    const json = await capture(() => run(['init', '--json'], ctx));
    const record = JSON.parse(json.out) as { hosts: unknown[]; hostChoices: { client: string; evidence: string }[] };
    assert.deepEqual(record.hosts, []);
    assert.deepEqual(record.hostChoices.map((h) => h.client), ['claude-code', 'codex']);
    for (const file of ['.mcp.json', '.codex', '.claude', '.agents']) assert.equal(existsSync(join(box.cwd, file)), false, file);
  } finally {
    box.cleanup();
  }
});

test('several hosts at the person’s own terminal: init asks once, and wires only what they pick', async () => {
  const atTerminal = (box: Sandbox, answer: string): CliContext => ({
    ...withHosts(box, 'claude', 'codex'),
    terminal: { interactive: true, agentAncestor: null },
    input: Readable.from([answer]),
  });
  const box = sandbox();
  try {
    const init = await capture(() => run(['init'], atTerminal(box, '1\n')));
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /Which agent hosts do you use in this project\?\n {2}1\) claude-code \(claude on PATH .*\)\n {2}2\) codex \(codex on PATH .*\)\nEnter numbers, or press Enter for all: /);
    assert.match(init.out, /host: claude-code wired \(\.mcp\.json starts `construct serve`; picked at the terminal\)/);
    assert.ok(existsSync(join(box.cwd, '.mcp.json')));
    assert.equal(existsSync(join(box.cwd, '.codex')), false);
  } finally {
    box.cleanup();
  }
  const all = sandbox();
  try {
    const init = await capture(() => run(['init'], atTerminal(all, '\n')));
    assert.equal(init.code, 0, init.err);
    assert.ok(existsSync(join(all.cwd, '.mcp.json')) && existsSync(join(all.cwd, '.codex', 'config.toml')), 'Enter wires every host listed');
    assert.ok(plantedIn(all, '.claude/skills') && plantedIn(all, '.agents/skills'));
  } finally {
    all.cleanup();
  }
  const none = sandbox();
  try {
    const init = await capture(() => run(['init'], atTerminal(none, '7\n')));
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /host: not connected\. "7" names none of the hosts listed\./);
    assert.equal(existsSync(join(none.cwd, '.mcp.json')), false);
  } finally {
    none.cleanup();
  }
});

test('a session relaying for the person is not asked: an agent ancestor means no prompt and no wiring', async () => {
  const box = sandbox();
  try {
    const ctx: CliContext = { ...withHosts(box, 'claude', 'codex'), terminal: { interactive: true, agentAncestor: '/usr/local/bin/codex' }, input: Readable.from(['1\n']) };
    const init = await capture(() => run(['init'], ctx));
    assert.doesNotMatch(init.out, /Which agent hosts/);
    assert.match(init.out, /host: not connected/);
  } finally {
    box.cleanup();
  }
});

test('--client=codex writes .codex/config.toml, plants .agents/skills, and says Codex must trust the project', async () => {
  const box = sandbox();
  try {
    const init = await capture(() => run(['init', '--client=codex'], box.ctx));
    assert.equal(init.code, 0, init.err);
    assert.match(readFileSync(join(box.cwd, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.construct\]/);
    assert.ok(plantedIn(box, '.agents/skills'));
    assert.match(init.out, /Next, in Codex:\n {2}1\. Start codex in this folder and trust the project when it asks; Codex reads \.codex\/config\.toml only in trusted projects\./);
  } finally {
    box.cleanup();
  }
});

test('--client=bob writes .bob/mcp.json and plants .bob/skills; --client=vscode plants .agents/skills', async () => {
  const box = sandbox();
  try {
    assert.equal((await capture(() => run(['init', '--client=bob'], box.ctx))).code, 0);
    assert.ok(existsSync(join(box.cwd, '.bob', 'mcp.json')));
    assert.ok(plantedIn(box, '.bob/skills'));
    const vscode = await capture(() => run(['init', '--client=vscode'], box.ctx));
    assert.ok(existsSync(join(box.cwd, '.vscode', 'mcp.json')));
    assert.ok(plantedIn(box, '.agents/skills'));
    assert.match(vscode.out, /Next, in VS Code:\n {2}1\. Open this folder in VS Code and trust the workspace/);
  } finally {
    box.cleanup();
  }
});

test('--client=claude-code,cursor wires both and plants one copy, in .claude/skills, that both read', async () => {
  const box = sandbox();
  try {
    const init = await capture(() => run(['init', '--client=claude-code,cursor', '--json'], box.ctx));
    assert.equal(init.code, 0, init.err);
    const record = JSON.parse(init.out) as { hosts: { client: string; mcp: { status: string }; skill: { dir: string } }[] };
    assert.deepEqual(record.hosts.map((h) => [h.client, h.mcp.status, h.skill.dir]), [['claude-code', 'installed', join(box.cwd, '.claude', 'skills')], ['cursor', 'installed', join(box.cwd, '.claude', 'skills')]]);
    assert.ok(plantedIn(box, '.claude/skills'));
    assert.equal(existsSync(join(box.cwd, '.agents')), false);
    // Repeating the flag names more hosts the same way.
    const again = await capture(() => run(['init', '--client=cursor', '--client=opencode'], box.ctx));
    assert.match(again.out, /host: cursor wired/);
    assert.match(again.out, /host: opencode wired/);
    assert.equal(existsSync(join(box.cwd, '.agents')), false, 'opencode reads the copy claude-code already has');
    const health = await doctor(box.ctx);
    assert.equal(health.healthy, true, JSON.stringify(health.checks.filter((c) => !c.ok)));
    assert.equal(health.checks.filter((c) => c.name === 'operational-skill').length, 1);
  } finally {
    box.cleanup();
  }
});

test('--client names a host that does not exist: exit 2 with every valid host', async () => {
  const box = sandbox();
  try {
    const bad = await capture(() => run(['init', '--client=claudecode'], box.ctx));
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--client must be one of claude-code \| cursor \| vscode \| opencode \| codex \| bob/);
    assert.equal(existsSync(join(box.cwd, '.construct')), false);
  } finally {
    box.cleanup();
  }
});

test('re-running init says the project’s statements are already proposed, and re-wires the hosts already wired here', async () => {
  const box = sandbox();
  try {
    const first = await capture(() => run(['init', '--client=cursor'], box.ctx));
    assert.match(first.out, /read from the project: (\d+) statement\(s\) extracted/);
    const count = /read from the project: (\d+) statement/.exec(first.out)![1];
    const again = await capture(() => run(['init'], box.ctx));
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, new RegExp(`read from the project: nothing new; ${count!} statement\\(s\\) already proposed`));
    assert.doesNotMatch(again.out, /no statements extracted/);
    assert.match(again.out, /host: cursor wired \(\.cursor\/mcp\.json starts `construct serve`; already wired in this project\)/);
    // --no-wire writes no host file, but the one an earlier run wrote still reaches Construct.
    const unwired = await capture(() => run(['init', '--no-wire'], box.ctx));
    assert.equal(unwired.code, 0, unwired.err);
    assert.match(unwired.out, /host: cursor wired earlier; no MCP configuration written \(--no-wire\)/);
    assert.doesNotMatch(unwired.out, /no agent session can reach Construct|not connected/);
  } finally {
    box.cleanup();
  }
});

test('re-init over an alpha.25 project repairs its .mcp.json and moves its hooks out of the shared settings, keeping the person\'s, and doctor is healthy', async () => {
  const box = sandbox();
  try {
    const made = await capture(() => run(['init', '--no-wire', '--scale=solo', '--outcome=x', '--constraint=y'], box.ctx));
    assert.equal(made.code, 0, made.err);
    const node = '/nonexistent/fnm/node-versions/v22.18.0/installation/bin/node';
    const install = '/nonexistent/lib/node_modules/@geraldmaron/construct/bin/construct.mjs';
    writeFileSync(join(box.cwd, '.mcp.json'), JSON.stringify({ mcpServers: { construct: { type: 'stdio', command: node, args: [install, 'serve', '--client=claude-code', `--project=${box.cwd}`] } } }, null, 2));
    const old = (event: string, matcher?: string) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `${node} ${install} hook ${event} --client=claude-code --project=${box.cwd}`, timeout: 20 }] });
    const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
    mkdirSync(join(box.cwd, '.claude'), { recursive: true });
    writeFileSync(join(box.cwd, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [mine, old('post-tool', '*')], Stop: [old('stop')], SessionStart: [old('session-start')] } }, null, 2));

    const before = await doctor(box.ctx);
    assert.equal(before.healthy, false);
    const staleHooks = before.checks.find((c) => c.name === 'host-hooks')!;
    assert.equal(staleHooks.ok, false);
    assert.match(staleHooks.detail, /\.claude\/settings\.json, the shared file, still holds 3 construct hook\(s\).*`construct init --client=claude-code` repairs them/);

    const again = await capture(() => run(['init'], box.ctx));
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /host: claude-code wired \(\.mcp\.json starts `construct serve`; already wired in this project\)/);
    assert.match(again.out, /hooks: installed \(.*; moved 3 old construct hook\(s\) out of \.claude\/settings\.json\)/);
    assert.deepEqual(JSON.parse(readFileSync(join(box.cwd, '.claude', 'settings.json'), 'utf8')), { hooks: { PostToolUse: [mine] } }, 'the person\'s hook stays where it was');
    const local = JSON.parse(readFileSync(join(box.cwd, '.claude', 'settings.local.json'), 'utf8')) as { hooks: Record<string, unknown[]> };
    assert.deepEqual(Object.keys(local.hooks), ['PostToolUse', 'Stop', 'SessionStart']);
    assert.ok(!readFileSync(join(box.cwd, '.mcp.json'), 'utf8').includes('/nonexistent/'));

    const after = await doctor(box.ctx);
    assert.equal(after.healthy, true, JSON.stringify(after.checks.filter((c) => !c.ok)));
    assert.match(after.checks.find((c) => c.name === 'host-hooks')!.detail, /^\.claude\/settings\.local\.json runs construct hook on PostToolUse, Stop, SessionStart/);
  } finally {
    box.cleanup();
  }
});
