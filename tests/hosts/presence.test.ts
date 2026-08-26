/**
 * tests/hosts/presence.test.ts — host presence is a report of what the
 * binaries actually said, and absence reads as information, not failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presenceLines, surveyHosts } from '../../src/hosts/presence.ts';
import type { ProbeExec } from '../../src/hosts/presence.ts';

const world = (answers: Record<string, string | null>): ProbeExec => {
  return (file, args) => answers[`${file} ${args.join(' ')}`] ?? null;
};

test('a machine with every host reports versions, pins, and codex auth', () => {
  const rows = surveyHosts(
    world({
      'opencode --version': '1.15.4',
      'claude --version': '2.1.216 (Claude Code)',
      'codex --version': 'codex-cli 0.145.0',
      'codex login status': 'Logged in using ChatGPT',
    }),
  );
  const byHost = Object.fromEntries(rows.map((r) => [r.host, r]));
  assert.equal(byHost.opencode?.found, true);
  assert.equal(byHost.opencode?.version, '1.15.4');
  assert.equal(byHost.opencode?.dispatchable, true);
  assert.equal(byHost.opencode?.spawnable, true);
  assert.equal(byHost.claude?.dispatchable, true);
  assert.equal(byHost.codex?.found, true);
  assert.equal(byHost.codex?.dispatchable, true);
  assert.equal(byHost.codex?.auth, 'Logged in using ChatGPT');
  assert.equal(byHost.bob?.spawnable, false);
  assert.equal(byHost.bob?.dispatchable, false);
});

test('a bare machine reports every host as not found and stays a report', () => {
  const rows = surveyHosts(world({}));
  assert.ok(rows.every((r) => !r.found && !r.dispatchable && !r.spawnable));
  for (const line of presenceLines(rows)) {
    assert.match(line, /not found/);
    assert.match(line, /spawnable: no/);
  }
});

test('a found host whose auth probe answers nothing says so instead of guessing', () => {
  const rows = surveyHosts(world({ 'codex --version': 'codex-cli 0.145.0' }));
  const codexLine = presenceLines(rows).find((l) => l.startsWith('codex:'));
  assert.ok(codexLine);
  assert.match(codexLine, /login status unavailable/);
});
