/**
 * tests/cli/status.test.ts — `construct status`, the one-screen answer to
 * "where am I right now": the latest run's task counts, the decision inbox,
 * pending write proposals, and the ambient host, plus its `--json` twin.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { status } from '../../src/cli/index.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { startRunSelected } from '../../src/kernel/run/outcome.ts';
import { claimTask, completeTask } from '../../src/kernel/store/tasks.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';

const AT = '2026-08-25T00:00:00.000Z';

/**
 * One `status()` call against a throwaway store and a sterile environment, so
 * neither the real ambient markers nor a real store leak into the assertion.
 * `seed` runs first, against the same store, for tests that need data in
 * place before the command reads it. `env` layers ambient-host markers on top
 * of a wiped set of them, so "no host detected" is a real assertion and not
 * an accident of whatever launched the test runner.
 */
const ENV_KEYS = [
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CURSOR_AGENT',
  'CURSOR_CLI',
  'BOB_SHELL_CLI_IDE_SERVER_PORT',
] as const;

async function run(
  seed: (store: ReturnType<typeof openStore>) => void,
  argv: string[],
  env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {},
): Promise<{ code: number; out: string }> {
  const root = mkdtempSync(join(tmpdir(), 'construct-status-'));
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
    (typeof ENV_KEYS)[number],
    string | undefined
  >;
  // Every ambient marker cleared first, so "no host detected" is a real
  // assertion about this store and this environment, not an accident of
  // whatever launched the test runner.
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    const store = openStore(storePath(resolvePaths()));
    seed(store);
    store.close();
    const code = status(argv);
    return { code, out: out.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test('status on an empty workspace answers gracefully rather than erroring', async () => {
  const { code, out } = await run(() => {}, ['status']);
  assert.equal(code, 0);
  assert.match(out, /no runs yet/);
  assert.match(out, /construct outcome/);
  assert.match(out, /open decisions: none/);
  assert.match(out, /pending proposals: none/);
  assert.match(out, /ambient host: none detected/);
});

test('status summarizes the latest run, task counts, open decisions, and ambient host', async () => {
  const { code, out } = await run(
    (store) => {
      startRunSelected(store, { runId: 'run-status-a', outcome: 'earlier outcome', at: AT, domains: ['security'] });
      const started = startRunSelected(store, {
        runId: 'run-status-b',
        outcome: 'the latest outcome',
        at: '2026-08-25T00:05:00.000Z',
        domains: ['privacy'],
      });
      // Settle one of the latest run's tasks, so pending and done both show.
      const taskId = started.tasks[0]!;
      const leased = claimTask(store, {
        owner: 'w-1',
        leaseUntil: '2026-08-25T01:00:00.000Z',
        now: AT,
        run: 'run-status-b',
      });
      assert.ok(leased);
      completeTask(store, {
        id: taskId,
        owner: 'w-1',
        token: leased!.token,
        at: AT,
        result: 'done',
        spend: 0,
        spendReported: false,
      });
      raiseDecision(store, {
        id: 'run-status-b:stance',
        run: 'run-status-b',
        question: 'ship now or wait?',
        positions: [
          { role: 'strategy-alignment', stance: 'ship now', citation: 'task:t-1#L1' },
          { role: 'compliance', stance: 'wait for the audit', citation: 'task:t-2#L1' },
        ],
        raisedAt: AT,
      });
    },
    ['status'],
    { CLAUDECODE: '1' },
  );
  assert.equal(code, 0);
  assert.match(out, /latest run: run-status-b/, 'the most recently touched run, not the first one recorded');
  assert.doesNotMatch(out, /run-status-a/);
  assert.match(out, /1 done, .* pending/);
  assert.match(out, /open decisions: 1/);
  assert.match(out, /ambient host: claude \(detected via CLAUDECODE\)/);
});

test('status --json round-trips and carries the same facts the prose reports', async () => {
  const { code, out } = await run(
    (store) => {
      startRunSelected(store, { runId: 'run-status-json', outcome: 'json outcome', at: AT, domains: ['security'] });
    },
    ['status', '--json'],
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as {
    latestRun: string | null;
    taskCounts: { total: number } | null;
    openDecisions: number;
    pendingProposals: number;
    ambient: { host: string; marker: string } | null;
  };
  assert.equal(parsed.latestRun, 'run-status-json');
  assert.ok(parsed.taskCounts && parsed.taskCounts.total > 0);
  assert.equal(parsed.openDecisions, 0);
  assert.equal(parsed.pendingProposals, 0);
  assert.equal(parsed.ambient, null);
});
