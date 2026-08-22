/**
 * tests/hosts/census.test.ts — the census reads cost off what a probe actually
 * printed, and says "unmeasured" everywhere else.
 *
 * The failure this guards against is a cheerful one: reporting a resource as
 * free or already-paid-for because it plausibly is, and having a user's first
 * bill be the correction. So every case here is either a probe line that
 * states who pays, or an absence that must stay an absence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censusLines, CENSUS_HOSTS, resourcesFrom, surveyResources } from '../../src/hosts/census.ts';
import { surveyHosts } from '../../src/hosts/presence.ts';
import type { ProbeExec } from '../../src/hosts/presence.ts';
import { HOST_NAMES } from '../../src/cli/runtime.ts';

const world = (answers: Record<string, string | null>): ProbeExec => {
  return (file, args) => answers[`${file} ${args.join(' ')}`] ?? null;
};

const everything = {
  'opencode --version': '1.15.4',
  'claude --version': '2.1.216 (Claude Code)',
  'codex --version': 'codex-cli 0.145.0',
  'cursor-agent --version': '2026.08.01',
};

function byHost(exec: ProbeExec, model?: string): Record<string, ReturnType<typeof resourcesFrom>[number]> {
  return Object.fromEntries(resourcesFrom(surveyHosts(exec), model).map((r) => [r.host, r]));
}

test('the census covers exactly the hosts the CLI will dispatch to', () => {
  assert.deepEqual([...CENSUS_HOSTS].sort(), [...HOST_NAMES].sort());
  assert.deepEqual(
    resourcesFrom(surveyHosts(world({}))).map((r) => r.host).sort(),
    [...HOST_NAMES].sort(),
    'a host the survey knows and the census does not would be invisible to selection',
  );
});

test('a bare machine reports nothing dispatchable and nothing priced', () => {
  for (const resource of resourcesFrom(surveyHosts(world({})))) {
    assert.equal(resource.found, false);
    assert.equal(resource.dispatchable, false);
    assert.equal(resource.costClass, 'unknown', `${resource.host} was priced with no binary present`);
  }
});

test('a ChatGPT login is the subscription case, and an API key is the metered one', () => {
  const subscription = byHost(
    world({ ...everything, 'codex login status': 'Logged in using ChatGPT' }),
  );
  assert.equal(subscription.codex?.costClass, 'subscription');
  assert.match(subscription.codex?.costReason ?? '', /ChatGPT login/);

  const key = byHost(world({ ...everything, 'codex login status': 'Logged in using an API key' }));
  assert.equal(key.codex?.costClass, 'metered');
  assert.match(key.codex?.costReason ?? '', /bills per call/);
});

test('a codex that is present but says nothing about its login stays unmeasured', () => {
  const rows = byHost(world(everything));
  assert.equal(rows.codex?.found, true);
  assert.equal(rows.codex?.costClass, 'unknown', 'present is not the same as priced');
});

test('a signed-in Cursor is a subscription and a signed-out one is not priced at all', () => {
  const inn = byHost(world({ ...everything, 'cursor-agent status': 'Logged in as someone@example.com' }));
  assert.equal(inn.cursor?.costClass, 'subscription');

  const out = byHost(world(everything));
  assert.equal(out.cursor?.found, true);
  assert.equal(out.cursor?.costClass, 'unknown', '"not logged in" says nothing about price');
});

test('a locally served model is free on the host that actually serves them, and nowhere else', () => {
  const rows = byHost(world(everything), 'ollama/qwen3.5:4b');
  assert.equal(rows.opencode?.costClass, 'local');
  assert.match(rows.opencode?.costReason ?? '', /costs nothing/);
  assert.equal(
    rows.claude?.costClass,
    'unknown',
    'the same string on a host that cannot resolve it is not a free run',
  );
});

test('a host with no auth probe and no local model is unmeasured, not assumed cheap', () => {
  const rows = byHost(world(everything));
  assert.equal(rows.opencode?.costClass, 'unknown');
  assert.match(rows.opencode?.costReason ?? '', /unmeasured/);
  assert.equal(rows.claude?.costClass, 'unknown');
});

test('capability declarations come from the adapters, so only two hosts can write outward', () => {
  const rows = byHost(world(everything));
  assert.ok(rows.opencode?.capabilities.includes('outward-write'));
  assert.ok(rows.claude?.capabilities.includes('outward-write'));
  assert.equal(rows.codex?.capabilities.includes('outward-write'), false);
  assert.equal(rows.cursor?.capabilities.includes('outward-write'), false);
});

test('each host resolves the tier through its own pin, and an unknown model stays unsaid', () => {
  const strong = byHost(world(everything), 'anthropic/claude-fable-1');
  assert.equal(strong.opencode?.tier, 'frontier');
  assert.equal(strong.codex?.tier, null, 'a model this pin does not recognise is not guessed upward');

  const gpt = byHost(world(everything), 'gpt-5.2');
  assert.equal(gpt.codex?.tier, 'frontier');

  assert.equal(byHost(world(everything)).opencode?.tier, null, 'no model named means no tier claimed');
});

test('a census row carries the same presence sentence doctor shows, plus what it costs', () => {
  const lines = censusLines(resourcesFrom(surveyHosts(world({ ...everything, 'codex login status': 'Logged in using ChatGPT' }))));
  const codexLine = lines.find((l) => l.startsWith('codex:'));
  assert.ok(codexLine);
  assert.match(codexLine, /codex-cli 0\.145\.0/, 'the version the binary printed');
  assert.match(codexLine, /pinned:/, 'the version the adapter was verified against');
  assert.match(codexLine, /cost: subscription/);
});

test('surveying takes one probe pass and hands back the same rows the mapper would', () => {
  const exec = world(everything);
  assert.deepEqual(surveyResources(exec), resourcesFrom(surveyHosts(exec)));
});
