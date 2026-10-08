/**
 * tests/cli/doctor-hosts.test.ts — doctor fails a project no host is wired
 * to; for each wired host it checks that the command its file starts can be
 * found from here, and says whether it is the same install as the doctor
 * running; and it checks the operational skill where the wired hosts read it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import type { CliContext } from '../../src/cli/context.ts';
import { CHECKOUT_LAUNCHER } from '../harness/sterile.ts';
import { capture, sandbox, type Sandbox } from './support.ts';

interface Check { readonly name: string; readonly ok: boolean; readonly detail: string }

async function doctorWith(box: Sandbox, path: string): Promise<{ healthy: boolean; checks: Check[] }> {
  const ctx: CliContext = { ...box.ctx, env: { ...box.ctx.env, PATH: path } };
  const r = await capture(() => run(['doctor', '--json'], ctx));
  return JSON.parse(r.out) as { healthy: boolean; checks: Check[] };
}

async function wired(box: Sandbox, ...clients: string[]): Promise<void> {
  for (const client of clients) {
    const init = await capture(() => run(['init', `--client=${client}`, '--scale=solo', '--outcome=x', '--constraint=y', `--skills-dir=${join(box.home, 'skills')}`], box.ctx));
    assert.equal(init.code, 0, init.err + init.out);
  }
}

test('host-launch fails without construct on PATH and passes with this checkout’s construct', async () => {
  const box = sandbox();
  try {
    await wired(box, 'claude-code', 'cursor');
    const empty = join(box.home, 'empty-bin');
    mkdirSync(empty);
    const missing = await doctorWith(box, empty);
    assert.equal(missing.healthy, false);
    const claude = missing.checks.find((c) => c.name === 'host-launch:claude-code')!;
    assert.equal(claude.ok, false);
    assert.match(claude.detail, /`construct` is not on PATH here, so claude-code cannot start the server; install it with npm install -g @geraldmaron\/construct@alpha or as a project dependency$/);
    assert.match(missing.checks.find((c) => c.name === 'host-launch:cursor')!.detail, /a host started from the Dock may see another\)$/);

    const present = await doctorWith(box, box.ctx.env.PATH!);
    assert.equal(present.healthy, true, JSON.stringify(present.checks.filter((c) => !c.ok)));
    const ok = present.checks.find((c) => c.name === 'host-launch:claude-code')!;
    assert.equal(ok.ok, true);
    assert.match(ok.detail, /^starts .*\/bin\/construct, the same install as this doctor$/);
  } finally {
    box.cleanup();
  }
});

test('host-launch says when the construct on PATH is a different install', async () => {
  const box = sandbox();
  try {
    await wired(box, 'codex');
    const other = join(box.home, 'other-bin');
    mkdirSync(other);
    copyFileSync(CHECKOUT_LAUNCHER, join(other, 'construct'));
    chmodSync(join(other, 'construct'), 0o755);
    const r = await doctorWith(box, other);
    const launch = r.checks.find((c) => c.name === 'host-launch:codex')!;
    assert.equal(launch.ok, true, launch.detail);
    assert.match(launch.detail, /, a different install than this doctor \(.*bin\/construct\.mjs\); versions may differ$/);
  } finally {
    box.cleanup();
  }
});

test('host-launch checks a project dependency through npx, and an absolute command by its path', async () => {
  const box = sandbox();
  try {
    await wired(box, 'bob');
    writeFileSync(join(box.cwd, '.mcp.json'), JSON.stringify({ mcpServers: { construct: { type: 'stdio', command: 'npx', args: ['--no-install', 'construct', 'serve', '--client=claude-code'] } } }), 'utf8');
    const withNpx = join(box.home, 'npx-bin');
    mkdirSync(withNpx);
    writeFileSync(join(withNpx, 'npx'), '#!/bin/sh\n', { mode: 0o755 });
    const noDependency = (await doctorWith(box, withNpx)).checks.find((c) => c.name === 'host-launch:claude-code')!;
    assert.equal(noDependency.ok, false);
    assert.match(noDependency.detail, /node_modules\/\.bin\/construct does not exist, so npx --no-install construct has nothing to start/);
    mkdirSync(join(box.cwd, 'node_modules', '.bin'), { recursive: true });
    symlinkSync(CHECKOUT_LAUNCHER, join(box.cwd, 'node_modules', '.bin', 'construct'));
    const dependency = (await doctorWith(box, withNpx)).checks.find((c) => c.name === 'host-launch:claude-code')!;
    assert.equal(dependency.ok, true, dependency.detail);
    assert.match(dependency.detail, /through .*npx-bin\/npx, the same install as this doctor$/);

    writeFileSync(join(box.cwd, '.bob', 'mcp.json'), JSON.stringify({ mcpServers: { construct: { command: '/nonexistent/node', args: ['serve', '--client=bob'] } } }), 'utf8');
    const r = await doctorWith(box, withNpx);
    const bob = r.checks.find((c) => c.name === 'host-launch:bob')!;
    assert.equal(bob.ok, false);
    assert.match(bob.detail, /\/nonexistent\/node cannot be found here, so bob cannot start the server; `construct init --client=bob` rewrites it/);
    assert.match(r.checks.find((c) => c.name === 'host-wiring')!.detail, /bob broken \(\.bob\/mcp\.json starts \/nonexistent\/node, which no longer exists/);
  } finally {
    box.cleanup();
  }
});

test('an alpha.25 .mcp.json is reported broken with its repair, and init --client repairs it', async () => {
  const box = sandbox();
  try {
    await wired(box, 'claude-code');
    const alpha25 = { mcpServers: { construct: { type: 'stdio', command: '/nonexistent/fnm/node-versions/v22.18.0/installation/bin/node', args: ['/nonexistent/lib/node_modules/@geraldmaron/construct/bin/construct.mjs', 'serve', '--client=claude-code', `--project=${box.cwd}`] } } };
    writeFileSync(join(box.cwd, '.mcp.json'), JSON.stringify(alpha25, null, 2), 'utf8');
    const before = await doctorWith(box, box.ctx.env.PATH!);
    assert.equal(before.healthy, false);
    assert.match(before.checks.find((c) => c.name === 'host-wiring')!.detail, /claude-code broken \(\.mcp\.json starts \/nonexistent\/.*node, which no longer exists \(another machine's path or an old Node\); `construct init --client=claude-code` rewrites it\)/);
    assert.equal(before.checks.find((c) => c.name === 'host-launch:claude-code')!.ok, false);
    await wired(box, 'claude-code');
    const after = await doctorWith(box, box.ctx.env.PATH!);
    assert.equal(after.healthy, true, JSON.stringify(after.checks.filter((c) => !c.ok)));
    assert.match(after.checks.find((c) => c.name === 'host-wiring')!.detail, /^claude-code installed$/);
  } finally {
    box.cleanup();
  }
});

test('with no host wired, host-wiring fails, names the hosts found here, and gives the command that wires one', async () => {
  const box = sandbox();
  try {
    const init = await capture(() => run(['init', '--no-wire', '--scale=solo', '--outcome=x', '--constraint=y'], box.ctx));
    assert.equal(init.code, 0, init.err);
    assert.match(init.out, /host: not connected: no MCP configuration written \(--no-wire\)\nNext: run `construct init --client=<host>` without --no-wire/);
    mkdirSync(join(box.home, '.cursor'));
    const r = await doctorWith(box, box.ctx.env.PATH!);
    assert.equal(r.healthy, false);
    const wiring = r.checks.find((c) => c.name === 'host-wiring')!;
    assert.equal(wiring.ok, false);
    assert.equal(wiring.detail, 'no host wired, so no agent session can reach Construct; found cursor; `construct init --client=<host>` wires one');
    assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.name), ['host-wiring']);
  } finally {
    box.cleanup();
  }
});

test('the operational skill is checked once in each project skills directory a wired host reads, with init as the fix', async () => {
  const box = sandbox();
  try {
    await wired(box, 'codex', 'bob');
    const both = await doctorWith(box, box.ctx.env.PATH!);
    const skills = both.checks.filter((c) => c.name === 'operational-skill');
    assert.deepEqual(skills.map((c) => [c.ok, /in (\S+) \(read by (\S+)\)/.exec(c.detail)?.slice(1)]), [
      [true, [join(box.cwd, '.agents', 'skills'), 'codex']],
      [true, [join(box.cwd, '.bob', 'skills'), 'bob']],
    ]);
    rmSync(join(box.cwd, '.bob', 'skills'), { recursive: true, force: true });
    const missing = (await doctorWith(box, box.ctx.env.PATH!)).checks.filter((c) => c.name === 'operational-skill' && !c.ok);
    assert.equal(missing.length, 1);
    assert.match(missing[0]!.detail, /^absent in .*\.bob\/skills \(read by bob\): .*; `construct init --client=bob` plants /);
  } finally {
    box.cleanup();
  }
});
