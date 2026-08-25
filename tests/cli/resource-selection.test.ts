/**
 * tests/cli/resource-selection.test.ts — `construct work` with no host named
 * looks at what this machine actually has, dispatches to it, and writes down
 * which resource carried the run and what it passed over.
 *
 * Before this, a run with no `--host` went to one hardcoded name and failed if
 * that binary was absent, no matter what else was installed. The cases here are
 * the surface, not the unit: the machine is scripted through the same probe
 * doctor uses, so nothing spawns a real host binary and nothing depends on what
 * happens to be installed where the suite runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, work } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import type { ProbeExec } from '../../src/hosts/presence.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

// A dispatch reads the machine's agent skills directory to find out what
// method it can offer a role, so home is moved for this file: what the suite
// observes must not depend on what is installed for whoever runs it.
sterileHome();

// This file exercises the census-based selection that runs precisely when
// nothing else — a typed --host, a recorded dispatch surface, an ambient
// host with a wired adapter — already answered the question. Whoever runs
// this suite is itself very likely an ambient host (an agent session running
// its own tests), so ambient markers are cleared for the file: these cases
// are about the census, not about what invoked the test runner.
sterileAmbientEnv();

const OUTCOME = 'launch a paid beta to EU users next month';

const world = (answers: Record<string, string | null>): ProbeExec => {
  return (file, args) => answers[`${file} ${args.join(' ')}`] ?? null;
};

/** Answers to a host that is present but says nothing about who pays for it. */
const CLAUDE_ONLY = { 'claude --version': '2.1.216 (Claude Code)' };

/** A codex whose login probe states outright that a subscription pays. */
const CODEX_ON_SUBSCRIPTION = {
  'codex --version': 'codex-cli 0.145.0',
  'codex login status': 'Logged in using ChatGPT',
};

function standInHost(): HostAdapter {
  return {
    name: 'stand-in',
    kind: 'general',
    capabilities: [],
    init: async (): Promise<void> => {},
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    invoke: async (request: unknown): Promise<HostResult> => ({
      id: (request as { role?: string }).role ?? 'x',
      status: 'ok',
      output: { text: 'ISSUE: a thing worth raising.', usage: { cost: 0.01, steps: 1 } },
      error: null,
    }),
  };
}

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly entries: readonly { readonly action: string; readonly detail: unknown }[];
}

/**
 * Files a real run in a throwaway state dir, then works it against a scripted
 * machine. The store is read back afterwards rather than during, because the
 * CLI closes it around every command.
 */
async function runAgainst(
  probe: ProbeExec,
  options: { readonly override?: HostAdapter; readonly argv?: string[] } = {},
): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-select-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');

  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);

  try {
    await main(['outcome', OUTCOME]);
    const code = await work(options.argv ?? [], options.override, probe);
    const store = openStore(storePath(resolvePaths()));
    try {
      const entries = readWorkLog(store).map((e) => ({ action: e.action, detail: e.detail }));
      return { code, out: out.join(''), err: err.join(''), entries };
    } finally {
      store.close();
    }
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

function selections(capture: Capture): { readonly detail: Record<string, unknown> }[] {
  return capture.entries
    .filter((e) => e.action === 'resource-selected')
    .map((e) => ({ detail: e.detail as Record<string, unknown> }));
}

test('a run with no host named goes to the host that is actually installed', async () => {
  const capture = await runAgainst(world(CLAUDE_ONLY), { override: standInHost() });
  assert.match(capture.out, /resource: claude/, 'the one present host carried the run');
  assert.equal(capture.code, 0);
});

test('the subscription that is already paid for beats the host nobody priced', async () => {
  const capture = await runAgainst(world({ ...CLAUDE_ONLY, ...CODEX_ON_SUBSCRIPTION }), {
    override: standInHost(),
  });
  assert.match(capture.out, /resource: codex \(subscription cost\)/);
  assert.match(capture.out, /not chosen: claude \(costs more than codex/);
});

test('the choice, the cost, and everything passed over are on the work log', async () => {
  const capture = await runAgainst(world({ ...CLAUDE_ONLY, ...CODEX_ON_SUBSCRIPTION }), {
    override: standInHost(),
  });
  const recorded = selections(capture);
  assert.equal(recorded.length, 1, 'one entry for the run this invocation worked');
  const detail = recorded[0].detail;
  // OUTCOME implicates commerce-tax and privacy, both licensed-review domains,
  // so their briefs declare a "frontier" floor; codex is still the cheapest
  // present resource but never says what tier it runs, so the run degrades
  // rather than clearing.
  assert.equal(detail.rung, 'degraded');
  assert.equal(detail.host, 'codex');
  assert.equal(detail.costClass, 'subscription');
  assert.equal(detail.floor, 'frontier');
  assert.match(detail.degradation as string, /nothing present clears the "frontier" floor/);
  const rejected = detail.rejected as { host: string; why: string }[];
  assert.deepEqual(rejected.map((r) => r.host).sort(), ['claude', 'cursor', 'opencode']);
  for (const entry of rejected) assert.ok(entry.why.length > 0);
});

test('a machine with no host at all refuses, names what it looked for, and spends nothing', async () => {
  const capture = await runAgainst(world({}));
  assert.equal(capture.code, 1);
  assert.match(capture.err, /work: nothing present can carry this work/);
  assert.match(capture.err, /found: opencode \(not found on this machine\)/);
  assert.match(capture.err, /construct work --host=</, 'the refusal names the way past itself');
  assert.doesNotMatch(capture.out, /worked \d+ task/, 'nothing was dispatched');
  assert.equal(selections(capture)[0].detail.rung, 'refused', 'the refusal is on the record too');
});

test('a named host is the answer, and nothing is selected or recorded on its behalf', async () => {
  const capture = await runAgainst(world({ ...CLAUDE_ONLY, ...CODEX_ON_SUBSCRIPTION }), {
    override: standInHost(),
    argv: ['--host=opencode'],
  });
  assert.doesNotMatch(capture.out, /resource: /, 'a typed --host is not second-guessed');
  assert.equal(selections(capture).length, 0);
  assert.equal(capture.code, 0);
});

test('a binary path names its own host, so the census does not overrule it', async () => {
  const capture = await runAgainst(world({ ...CLAUDE_ONLY, ...CODEX_ON_SUBSCRIPTION }), {
    override: standInHost(),
    argv: ['--binary=/somewhere/opencode'],
  });
  assert.doesNotMatch(capture.out, /resource: /);
  assert.equal(selections(capture).length, 0);
});

test('a locally served model is chosen over a subscription, because re-running it is free', async () => {
  const capture = await runAgainst(
    world({ 'opencode --version': '1.15.4', ...CODEX_ON_SUBSCRIPTION }),
    { override: standInHost(), argv: ['--model=ollama/qwen3.5:4b'] },
  );
  assert.match(capture.out, /resource: opencode \(local cost\)/);
  assert.match(capture.out, /not chosen: codex \(costs more than opencode/);
});

test('a run with nothing to dispatch never probes for a host it would not use', async () => {
  let asked = 0;
  const counting: ProbeExec = (file, args) => {
    asked += 1;
    return world(CLAUDE_ONLY)(file, args);
  };
  const root = mkdtempSync(join(tmpdir(), 'construct-select-idle-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = () => true;
  try {
    const code = await work([], undefined, counting);
    assert.equal(code, 0);
    assert.equal(asked, 0, 'an empty store asked no binary what version it was');
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
