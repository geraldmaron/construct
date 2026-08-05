/**
 * tests/hosts/parity.test.ts — the smoke-parity gate between the two host
 * adapters: the same task, run through
 * OpenCode and through Claude, produces an EQUIVALENT deliverable. Divergence
 * fails here, by name, before any caller discovers it as a crash.
 *
 * Equivalence is structural, not textual: two different models will never say
 * the same words, and asserting they do would test the weather. What callers
 * actually depend on is that a deliverable from either host answers the same
 * questions — is there text, who produced it, what did it cost, what fired,
 * what failed. Both adapters are driven by transcripts captured from their
 * real binaries, so this is the real shape of both hosts, minus their latency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOpenCodeAdapter } from '../../src/hosts/opencode/adapter.ts';
import type { OpenCodeDeliverable } from '../../src/hosts/opencode/adapter.ts';
import { createClaudeAdapter } from '../../src/hosts/claude/adapter.ts';
import type { ClaudeDeliverable } from '../../src/hosts/claude/adapter.ts';
import { deliverableConcerns } from '../../src/kernel/run/accountability.ts';
import { spendOf } from '../../src/kernel/run/coordinator.ts';
import type { HostResult } from '../../src/kernel/hosts/interface.ts';

const OPENCODE_TRANSCRIPT = readFileSync(
  new URL('opencode/fixtures/simple-text.ndjson', import.meta.url),
  'utf8',
);
const CLAUDE_ENVELOPE = readFileSync(new URL('claude/fixtures/success.json', import.meta.url), 'utf8');

function stub(stdout: string, versionLine: string) {
  return (_command: string, args: readonly string[]) => ({
    done: Promise.resolve(
      args[0] === '--version' || args[0] === 'stats'
        ? { code: 0, stdout: versionLine, stderr: '' }
        : { code: 0, stdout, stderr: '' },
    ),
    kill: () => {},
  });
}

async function runBoth(): Promise<{ opencode: HostResult; claude: HostResult }> {
  const opencode = createOpenCodeAdapter({ spawn: stub(OPENCODE_TRANSCRIPT, '1.15.4\n') });
  const claude = createClaudeAdapter({
    spawn: stub(CLAUDE_ENVELOPE, '2.1.216 (Claude Code)\n'),
    model: 'haiku',
  });
  await opencode.init();
  await claude.init();
  const task = { role: 'privacy', task: 'Report what this outcome implicates in your domain.' };
  return {
    opencode: await opencode.invoke(task, { invocationId: 'parity-oc' }),
    claude: await claude.invoke(task, { invocationId: 'parity-cl' }),
  };
}

test('the same task through both hosts settles ok with a non-empty deliverable', async () => {
  const { opencode, claude } = await runBoth();
  for (const [name, result] of Object.entries({ opencode, claude })) {
    assert.equal(result.status, 'ok', `${name} did not settle ok`);
    const output = result.output as { text: string; role: string };
    assert.ok(output.text.trim().length > 0, `${name} deliverable has no text`);
    assert.equal(output.role, 'privacy', `${name} lost the role attribution`);
  }
});

test('both deliverables answer the same questions — the shared key set is the seam', async () => {
  const { opencode, claude } = await runBoth();
  const oc = opencode.output as OpenCodeDeliverable;
  const cl = claude.output as ClaudeDeliverable;

  // Every key the OpenCode deliverable exposes, the Claude one must expose
  // too. Claude may add accountability fields (modelRequested/modelRan);
  // it may not be MISSING anything a caller written against OpenCode reads.
  const ocKeys = Object.keys(oc).sort();
  const clKeys = new Set(Object.keys(cl));
  for (const key of ocKeys) {
    assert.ok(clKeys.has(key), `claude deliverable is missing "${key}" — a caller written against opencode breaks`);
  }

  // Both usages must speak to the spend ceiling in the same vocabulary.
  for (const [name, output] of [['opencode', oc], ['claude', cl]] as const) {
    const usage = output.usage as { cost: number; steps: number };
    assert.equal(typeof usage.cost, 'number', `${name} usage.cost is not a number`);
    assert.equal(typeof usage.steps, 'number', `${name} usage.steps is not a number`);
  }
});

test('kernel consumers read both deliverables without host-specific branches', async () => {
  const { opencode, claude } = await runBoth();
  for (const [name, result] of Object.entries({ opencode, claude })) {
    // Neither fixture is a defective run, so neither may raise concerns...
    assert.deepEqual(
      deliverableConcerns(result.output),
      [],
      `${name} raised concerns on a clean captured run`,
    );
    // ...and spendOf must produce a coherent answer for both. The VALUES
    // differ honestly: claude reports real dollars, the ollama-backed
    // opencode capture reports zero-out-of-zero, which is "unmeasured".
    const spend = spendOf(result);
    assert.equal(typeof spend.spend, 'number', `${name} spend is not a number`);
    assert.equal(typeof spend.reported, 'boolean');
  }
  assert.equal(spendOf(claude).reported, true, 'claude cost is measured, and must count as such');
});
