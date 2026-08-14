/**
 * tests/cli/lessons.test.ts — the held-lesson queue through its real surface.
 *
 * decide already distills a resolved decision and the gate holds it. These
 * hold that the queue is visible later, that approve goes through
 * decideAdmission with a named human, and that run-derived lessons still
 * never auto-admit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, lessons, main } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';
import { admissionOf, operationalLessonsFor } from '../../src/kernel/lessons/admission.ts';

const AT = '2026-08-14T00:00:00.000Z';

interface Session {
  readonly cli: (argv: string[]) => Promise<number>;
  readonly out: () => string;
  readonly err: () => string;
}

async function session(body: (s: Session) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'construct-lessons-'));
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
    await body({
      cli: (argv) => main(argv),
      out: () => out.join(''),
      err: () => err.join(''),
    });
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

function seedHeld(): void {
  const store = openStore(storePath(resolvePaths()));
  raiseDecision(store, {
    id: 'run-x:stance',
    run: 'run-x',
    question: 'mobile-launch-completion or UGC first?',
    positions: [
      { role: 'strategy-alignment', stance: 'mobile-launch-completion first', citation: 'task:t-1#L1' },
      { role: 'product-scoping', stance: 'UGC first', citation: 'task:t-2#L1' },
    ],
    raisedAt: AT,
  });
  store.close();
}

test('a held lesson from decide appears in lessons list --held', async () => {
  await session(async (s) => {
    seedHeld();
    assert.equal(await decide(['run-x:stance', 'mobile-launch-completion first; UGC waits']), 0);
    assert.equal(await s.cli(['lessons', 'list', '--workspace=run-x']), 0);
    assert.match(s.out(), /lesson-run-x:stance/);
    assert.match(s.out(), /held/);
    assert.match(s.out(), /decision:run-x:stance/);
    assert.match(s.out(), /hold: /);
    assert.match(s.out(), /own resolved decision/);
  });
});

test('approve with a named approver admits the lesson into the operational brief', async () => {
  await session(async (s) => {
    seedHeld();
    assert.equal(await decide(['run-x:stance', 'mobile-launch-completion first; UGC waits']), 0);
    assert.equal(
      await s.cli(['lessons', 'approve', 'lesson-run-x:stance', '--approver=gerald']),
      0,
    );
    assert.match(s.out(), /approved lesson-run-x:stance \(admitted\) by gerald/);

    const store = openStore(storePath(resolvePaths()));
    assert.equal(admissionOf(store, 'lesson-run-x:stance')?.verdict, 'admitted');
    assert.equal(admissionOf(store, 'lesson-run-x:stance')?.reviewer, 'gerald');
    assert.equal(operationalLessonsFor(store, 'run-x').length, 1);
    store.close();

    assert.equal(await s.cli(['lessons', 'list', '--workspace=run-x', '--admitted']), 0);
    assert.match(s.out(), /lesson-run-x:stance  run-x  admitted/);
  });
});

test('run-derived lessons still never auto-admit', async () => {
  await session(async () => {
    seedHeld();
    assert.equal(await decide(['run-x:stance', 'mobile-launch-completion first; UGC waits']), 0);
    const store = openStore(storePath(resolvePaths()));
    assert.equal(admissionOf(store, 'lesson-run-x:stance')?.verdict, 'held');
    assert.deepEqual(operationalLessonsFor(store, 'run-x'), []);
    store.close();
  });
});

test('unknown id fails closed; approve without an approver is usage', async () => {
  await session(async (s) => {
    assert.equal(await s.cli(['lessons', 'approve', 'lesson-missing', '--approver=gerald']), 1);
    assert.match(s.err(), /no lesson lesson-missing/);
    assert.equal(await lessons(['approve', 'lesson-missing']), 2);
    assert.match(s.err(), /usage: construct lessons/);
  });
});
