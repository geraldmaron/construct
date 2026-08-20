/**
 * tests/cli/lessons.test.ts — the held-lessons queue is visible, and a named
 * human admits from it through the real CLI surface.
 *
 * The property under test: a lesson the gate held is reachable without
 * opening the database by hand — it lists with the reason it was held, a
 * lesson with no verdict at all lists as held rather than vanishing, and the
 * one path to admitted runs through the same gate with a human's name on it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, lessons } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';
import { recordLesson } from '../../src/kernel/store/lessons.ts';
import { operationalLessonsFor } from '../../src/kernel/lessons/admission.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(fn: () => Promise<number>): Promise<Capture> {
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
  let code = 0;
  try {
    code = await fn();
    return { code, out: out.join(''), err: err.join('') };
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

test('a held run-derived lesson lists with its reason and admits under a named human', async () => {
  let operational = 0;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-a:stance',
      run: 'run-a',
      question: 'ship now or wait for the audit?',
      positions: [
        { role: 'strategy-alignment', stance: 'ship now', citation: 'task:t-1#L1' },
        { role: 'compliance', stance: 'wait for the audit', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-20T00:00:00.000Z',
    });
    store.close();
    await decide(['run-a:stance', 'wait for the audit']);

    const listed = lessons(['--workspace=run-a']);
    assert.equal(listed, 0);

    const admittedCode = lessons(['--admit=lesson-run-a:stance', '--by=gerald']);
    assert.equal(admittedCode, 0);

    // Inspected inside run()'s callback, before its finally block restores
    // XDG_DATA_HOME — the store this test wrote lives at the temp path.
    const check = openStore(storePath(resolvePaths()));
    operational = operationalLessonsFor(check, 'run-a').length;
    check.close();

    return lessons(['--workspace=run-a']);
  });

  assert.equal(code, 0);
  assert.match(out, /1 held, 0 admitted/);
  assert.match(out, /own resolved decision/, 'the held reason is shown, not just the verdict');
  assert.match(out, /Admit one with: construct lessons --admit=/);
  assert.match(out, /admitted lesson-run-a:stance: human approval by gerald/);
  assert.match(out, /0 held, 1 admitted/);
  assert.equal(operational, 1, 'a human-admitted lesson becomes operational');
});

test('a lesson with no recorded verdict lists as held, never as invisible', async () => {
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    recordLesson(store, {
      id: 'lesson-quiet',
      workspace: 'ws-quiet',
      kind: 'process',
      body: 'a lesson recorded with no admission decision at all',
      citation: 'note:n-1',
      external: false,
      supersedes: null,
      createdAt: '2026-08-20T00:00:00.000Z',
    });
    assert.deepEqual(operationalLessonsFor(store, 'ws-quiet'), [], 'not operational either');
    store.close();
    return lessons(['--workspace=ws-quiet']);
  });

  assert.equal(code, 0);
  assert.match(out, /1 held, 0 admitted/);
  assert.match(out, /no verdict recorded — absence of a verdict is a hold nobody wrote down/);
});

test('admitting needs a lesson that exists and a human who is named', async () => {
  const missingApprover = await run(async () => lessons(['--admit=lesson-x']));
  assert.equal(missingApprover.code, 2);
  assert.match(missingApprover.err, /admitting needs the lesson and its human/);

  // A bare `--by` parses as the sentinel 'true'; recording it would name the
  // approver "true" and forge the audit line, so it is a missing name.
  const bareBy = await run(async () => lessons(['--admit=lesson-x', '--by']));
  assert.equal(bareBy.code, 2);
  assert.match(bareBy.err, /admitting needs the lesson and its human/);

  const bareAdmit = await run(async () => lessons(['--admit', '--by=gerald']));
  assert.equal(bareAdmit.code, 2);

  const missingLesson = await run(async () => lessons(['--admit=lesson-x', '--by=gerald']));
  assert.equal(missingLesson.code, 1);
  assert.match(missingLesson.err, /no lesson lesson-x/);
});
