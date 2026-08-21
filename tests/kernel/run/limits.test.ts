/**
 * tests/kernel/run/limits.test.ts — what produced a deliverable, printed with
 * the deliverable.
 *
 * The panel finding behind this: a security deliverable — a role with no lens,
 * so no labeling rule of its own — carried no trace of the fact that an
 * unvalidated model family produced it. The fact was true and recorded, sitting
 * in the work log, invisible to anyone reading the deliverable, which is how
 * every deliverable is actually read. A qualification only its author can find
 * is not a qualification.
 *
 * The second half is ownership: a numbered issue whose resolving step has
 * nobody attached is a step nobody takes, and the work-product rules asked for
 * the step without ever asking who takes it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../src/kernel/store/open.ts';
import { appendWorkLog } from '../../../src/kernel/store/worklog.ts';
import { limitsFor } from '../../../src/kernel/run/accountability.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import { main } from '../../../src/cli/index.ts';
import { claimTask, completeTask, listTasks } from '../../../src/kernel/store/tasks.ts';

const AT = '2026-08-06T00:00:00.000Z';

function withStore(fn: (store: ReturnType<typeof openStore>) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'construct-limits-'));
  const store = openStore(join(root, 'construct.db'));
  try {
    fn(store);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test('an untuned family reaches the reader as a stated limit, not only a log line', () => {
  withStore((store) => {
    appendWorkLog(store, {
      run: 'run-1',
      task: 'run-1:security',
      role: 'security',
      action: 'model-untuned-best-effort',
      detail: { model: 'qwen3.5:4b', family: 'qwen', note: 'best-effort' },
      at: AT,
    });
    const limits = limitsFor(store, 'run-1', 'run-1:security');
    assert.equal(limits.length, 1);
    assert.match(limits[0].label, /best-effort/);
    assert.match(limits[0].label, /qwen family/);
    assert.match(limits[0].label, /may drop that qualification/);
  });
});

test('a run below its declared capability floor says so in the same place', () => {
  withStore((store) => {
    appendWorkLog(store, {
      run: 'run-1',
      task: 'run-1:privacy',
      role: 'privacy',
      action: 'model-floor-degraded',
      detail: { floor: 'strong', model: 'tiny', modelTier: 'weak', why: 'brief declares a "strong" floor; tiny is tier "weak"' },
      at: AT,
    });
    const limits = limitsFor(store, 'run-1', 'run-1:privacy');
    assert.equal(limits.length, 1);
    assert.match(limits[0].label, /below the declared capability floor/);
    assert.match(limits[0].label, /strong/);
  });
});

test('limits are per task: one degraded dispatch does not qualify its neighbour', () => {
  withStore((store) => {
    appendWorkLog(store, {
      run: 'run-1',
      task: 'run-1:security',
      role: 'security',
      action: 'model-untuned-best-effort',
      detail: { model: 'x', family: 'qwen' },
      at: AT,
    });
    assert.equal(limitsFor(store, 'run-1', 'run-1:privacy').length, 0);
  });
});

test('a deliverable with nothing recorded against it carries no invented limit', () => {
  withStore((store) => {
    appendWorkLog(store, {
      run: 'run-1',
      task: 'run-1:security',
      role: 'security',
      action: 'role-dispatched',
      detail: { host: 'stand-in' },
      at: AT,
    });
    assert.deepEqual(limitsFor(store, 'run-1', 'run-1:security'), []);
  });
});

test('construct show prints the limit beside the text it qualifies, for a lens-less role', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-show-limits-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  try {
    // security is the lens-less role the panel finding was written against: no
    // lens means no labeling rule of its own, so this is the case where the
    // fact reaches the reader here or nowhere.
    await main(['outcome', '--domains=security', 'store customer passwords properly']);
    const store = openStore(join(root, 'share', 'construct', 'construct.db'));
    let runId: string;
    let taskId: string;
    try {
      const task = listTasks(store)[0];
      runId = task.run;
      taskId = task.id;
      const leased = claimTask(store, {
        owner: 'test',
        leaseUntil: '2099-01-01T00:00:00.000Z',
        now: AT,
        run: runId,
      });
      completeTask(store, {
        id: taskId,
        owner: 'test',
        token: leased!.token,
        result: { text: 'FINDING\npasswords are stored in plaintext' },
        spend: 0,
        spendReported: false,
        at: AT,
      });
      appendWorkLog(store, {
        run: runId,
        task: taskId,
        role: 'security',
        action: 'model-untuned-best-effort',
        detail: { model: 'nemotron-3-super', family: 'nemotron' },
        at: AT,
      });
    } finally {
      store.close();
    }
    out.length = 0;
    await main(['show', '--run', runId]);
    const text = out.join('');
    assert.match(text, /passwords are stored in plaintext/);
    assert.match(text, /best-effort/);
    assert.match(text, /nemotron family/);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('every issue owes an owner or an explicit unowned marker', () => {
  const brief: Brief = {
    id: 't',
    outcome: 'move the warehouse',
    role: 'security',
    inputs: [],
    capabilities: [],
    postconditions: [],
  };
  const assignment = assignmentFor(brief);
  // Security's template asks for issues, so the issue rule is the one spoken.
  assert.match(assignment, /then who takes that step/);
  // And the owner rule is owed by every form, not only that one: a step with
  // nobody attached is a step nobody takes, whatever the deliverable is called.
  assert.match(assignment, /Every step you recommend names an owner/);
  assert.match(assignment, /\[unowned\]/);
  for (const role of ['product-scoping', 'strategy-alignment', 'program-sequencing']) {
    assert.match(assignmentFor({ ...brief, role }), /Every step you recommend names an owner/);
    assert.match(assignmentFor({ ...brief, role }), /\[unowned\]/);
  }
});
