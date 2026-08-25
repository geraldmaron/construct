/**
 * tests/cli/json-flag.test.ts — the read verbs speak JSON when asked.
 *
 * The property under test, for `log`, `inbox`, `show`, `source list`,
 * `lessons`, and `plan`: `--json` prints output that round-trips through
 * `JSON.parse` and carries the same stored-record fields the human rendering
 * is built from, not a serialization of the prose itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inbox, lessons, log, plan, show, source } from '../../src/cli/index.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { startRunSelected } from '../../src/kernel/run/outcome.ts';
import { claimTask, completeTask, enqueueTask } from '../../src/kernel/store/tasks.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';
import { recordLesson } from '../../src/kernel/store/lessons.ts';
import { addSource } from '../../src/kernel/store/sources.ts';
import { recordPlan } from '../../src/kernel/store/plans.ts';
import { buildPlan } from '../../src/kernel/plan/planner.ts';

const AT = '2026-08-25T00:00:00.000Z';

/**
 * One command against a throwaway store, returning its exit code and
 * whatever it wrote to stdout. `seed` runs first, against the same store,
 * for tests that need data in place before the command reads it.
 */
async function run(seed: (store: ReturnType<typeof openStore>) => void, fn: () => number): Promise<{ code: number; out: string }> {
  const root = mkdtempSync(join(tmpdir(), 'construct-json-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  try {
    const store = openStore(storePath(resolvePaths()));
    seed(store);
    store.close();
    const code = fn();
    return { code, out: out.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

test('log --json round-trips and carries the work log entries and task rows', async () => {
  const { code, out } = await run(
    (store) => {
      startRunSelected(store, { runId: 'run-json', outcome: 'ship the thing', at: AT, domains: ['security'] });
    },
    () => log(['--run=run-json', '--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as { run: string; entries: unknown[]; tasks: unknown[] };
  assert.equal(parsed.run, 'run-json');
  assert.ok(parsed.entries.length > 0, 'the work log entries the human rendering lists');
  assert.ok(parsed.tasks.length > 0, 'the task rows the human rendering summarizes in its footer');
});

test('inbox --json round-trips and carries the open decisions', async () => {
  const { code, out } = await run(
    (store) => {
      raiseDecision(store, {
        id: 'run-x:stance',
        run: 'run-x',
        question: 'ship now or wait?',
        positions: [
          { role: 'strategy-alignment', stance: 'ship now', citation: 'task:t-1#L1' },
          { role: 'compliance', stance: 'wait for the audit', citation: 'task:t-2#L1' },
        ],
        raisedAt: AT,
      });
    },
    () => inbox(['--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as { openDecisions: Array<{ id: string; question: string }>; pendingProposals: number };
  assert.equal(parsed.openDecisions.length, 1);
  assert.equal(parsed.openDecisions[0].id, 'run-x:stance');
  assert.equal(parsed.openDecisions[0].question, 'ship now or wait?');
  assert.equal(parsed.pendingProposals, 0);
});

test('show --json round-trips and carries the task and its deliverable text', async () => {
  const { code, out } = await run(
    (store) => {
      enqueueTask(store, { id: 'task-json', run: 'run-show', role: 'security', brief: null, at: AT });
      const leased = claimTask(store, { owner: 'w-1', leaseUntil: '2026-08-25T01:00:00.000Z', now: AT });
      assert.ok(leased);
      completeTask(store, {
        id: 'task-json',
        owner: 'w-1',
        token: leased!.token,
        at: AT,
        result: 'the assessed answer',
        spend: 0,
        spendReported: false,
      });
    },
    () => show(['--run=run-show', '--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as { run: string; tasks: Array<{ id: string; state: string; deliverable: string }> };
  assert.equal(parsed.run, 'run-show');
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].id, 'task-json');
  assert.equal(parsed.tasks[0].state, 'done');
  assert.equal(parsed.tasks[0].deliverable, 'the assessed answer');
});

test('source list --json round-trips and carries the declared source rows', async () => {
  const { code, out } = await run(
    (store) => {
      addSource(store, { id: 'src-json-1', workspace: 'default', kind: 'directory', locator: '/repo', addedAt: AT });
    },
    () => source(['list', '--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as Array<{ id: string; kind: string; locator: string }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'src-json-1');
  assert.equal(parsed[0].kind, 'directory');
  assert.equal(parsed[0].locator, '/repo');
});

test('lessons --json round-trips and carries the recorded lesson and its verdict', async () => {
  const { code, out } = await run(
    (store) => {
      recordLesson(store, {
        id: 'lesson-json',
        workspace: 'ws-json',
        kind: 'process',
        body: 'a lesson recorded for the json test',
        citation: 'note:n-1',
        external: false,
        supersedes: null,
        createdAt: AT,
      });
    },
    () => lessons(['--workspace=ws-json', '--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as Array<{ lesson: { id: string; body: string }; verdict: unknown }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].lesson.id, 'lesson-json');
  assert.equal(parsed[0].lesson.body, 'a lesson recorded for the json test');
});

test('plan --json round-trips and carries the whole plan record', async () => {
  const built = buildPlan({
    id: 'plan-run-json',
    run: 'run-plan-json',
    outcome: 'assess the webhook',
    densified: null,
    implicated: [{ domain: 'security', concern: 'c', score: 10, signals: ['webhook'] }],
    inferredBy: 'keywords',
    sources: [],
    workspace: 'default',
    mode: 'team',
    plannedAt: AT,
  });
  const { code, out } = await run(
    (store) => recordPlan(store, built),
    () => plan(['run-plan-json', '--json']),
  );
  assert.equal(code, 0);
  const parsed = JSON.parse(out) as { id: string; run: string; outcome: string };
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(built)));
});
