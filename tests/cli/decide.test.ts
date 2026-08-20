/**
 * tests/cli/decide.test.ts — resolving a decision through the real CLI
 * surface, and what that resolution now leaves behind.
 *
 * The property under test: a resolved cross-domain decision becomes a
 * candidate lesson automatically, citing the decision rather than any note,
 * and the admission gate holds it for a human exactly as it holds an
 * ingested external document — never silently admitted for having come from
 * inside the system.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { raiseDecision } from '../../src/kernel/store/decisions.ts';
import { lessonsFor } from '../../src/kernel/store/lessons.ts';
import { admissionOf, operationalLessonsFor } from '../../src/kernel/lessons/admission.ts';
import {
  addSource,
  decideProposal,
  proposeWrite,
  setEngagementMode,
} from '../../src/kernel/store/sources.ts';
import { getProjection } from '../../src/kernel/store/projections.ts';
import type { HostAdapter } from '../../src/kernel/hosts/interface.ts';

const AT = '2026-08-13T00:00:00.000Z';

interface Capture {
  readonly code: number;
  readonly out: string;
}

async function run(fn: () => Promise<number>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-decide-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  let code = 0;
  try {
    code = await fn();
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

test('resolving a decision distills it into a held, run-derived lesson', async () => {
  let checked = false;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-x:stance',
      run: 'run-x',
      question: 'mobile-launch-completion or UGC first?',
      positions: [
        { role: 'strategy-alignment', stance: 'mobile-launch-completion first', citation: 'task:t-1#L1' },
        { role: 'product-scoping', stance: 'UGC first', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-13T00:00:00.000Z',
    });
    store.close();
    const result = await decide(['run-x:stance', 'mobile-launch-completion first; UGC waits']);

    // Inspected inside run()'s callback, before its finally block restores
    // XDG_DATA_HOME — the store this test wrote lives at the temp path, not
    // wherever the environment points once the harness has cleaned up.
    const check = openStore(storePath(resolvePaths()));
    const lessons = lessonsFor(check, 'run-x');
    assert.equal(lessons.length, 1);
    assert.equal(lessons[0].citation, 'decision:run-x:stance');
    assert.match(lessons[0].body, /mobile-launch-completion or UGC first\?/);
    assert.equal(admissionOf(check, 'lesson-run-x:stance')?.verdict, 'held');
    assert.deepEqual(operationalLessonsFor(check, 'run-x'), [], 'never auto-admitted');
    check.close();
    checked = true;

    return result;
  });

  assert.equal(code, 0);
  assert.ok(checked);
  assert.match(out, /decided run-x:stance/);
  assert.match(out, /distilled lesson-run-x:stance \(held\)/);
  assert.match(out, /own resolved decision/);
});

test('an open decision left unresolved leaves no lesson behind', async () => {
  const { code } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    raiseDecision(store, {
      id: 'run-y:stance',
      run: 'run-y',
      question: 'q',
      positions: [
        { role: 'strategy-alignment', stance: 'a', citation: 'task:t-1#L1' },
        { role: 'product-scoping', stance: 'b', citation: 'task:t-2#L1' },
      ],
      raisedAt: '2026-08-13T00:00:00.000Z',
    });
    assert.deepEqual(lessonsFor(store, 'run-y'), []);
    store.close();
    return 0;
  });
  assert.equal(code, 0);
});

test('an apply in seat mode prints the mirror it recorded before the change crossed', async () => {
  const outwardHost: HostAdapter = {
    name: 'stand-in',
    kind: 'coding',
    capabilities: ['outward-write'],
    init: async () => {},
    invoke: async () => ({
      id: 'i-1',
      status: 'ok',
      output: { text: '{"applied":true,"detail":"moved PROJ-14 to Q4"}' },
      error: null,
    }),
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
  };

  let mirrored = false;
  const { code, out } = await run(async () => {
    const store = openStore(storePath(resolvePaths()));
    addSource(store, { id: 'src-1', workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
    setEngagementMode(store, 'acme', 'seat', AT);
    proposeWrite(store, {
      id: 'p-1',
      workspace: 'acme',
      run: 'run-1',
      source: 'src-1',
      change: 'move PROJ-14 target date to Q4',
      justification: 'note:n-1#L3',
      risk: 'low',
      proposedAt: AT,
    });
    decideProposal(store, 'p-1', 'approved', 'yes, move it', AT);
    store.close();

    const result = await decide(['--apply=p-1'], outwardHost);

    const check = openStore(storePath(resolvePaths()));
    mirrored = getProjection(check, 'jira:p-1') !== null;
    check.close();
    return result;
  });

  assert.equal(code, 0);
  assert.ok(mirrored, 'the crossing is on the mirror');
  assert.match(out, /mirrored as jira:p-1 before it crossed/);
  assert.match(out, /applied p-1: moved PROJ-14 to Q4/);
});
