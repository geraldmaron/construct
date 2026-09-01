/**
 * tests/cli/watch-inert.test.ts — divergence-inert relations are named, not silent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { source, watch } from '../../src/cli/index.ts';
import { declareSourceEdge } from '../../src/kernel/store/source-edges.ts';
import { declareSourceWatch } from '../../src/kernel/store/source-watches.ts';
import { sourcesFor } from '../../src/kernel/store/sources.ts';
import { openStore } from '../../src/kernel/store/open.ts';

function run(steps: readonly (() => number)[]): { code: number; out: string; err: string } {
  const root = mkdtempSync(join(tmpdir(), 'construct-watch-inert-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of steps) code = step();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function ground(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `construct-ground-${name}-`));
  writeFileSync(join(dir, 'a.md'), '# fixture\n');
  return dir;
}

test('source relations names a half-watched edge as divergence-inert', () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { code, out } = run([
      () =>
        source([
          'add',
          '--kind=directory',
          `--locator=${strategy}`,
          '--workspace=ops',
        ]),
      () =>
        source([
          'add',
          '--kind=directory',
          `--locator=${repo}`,
          '--workspace=ops',
        ]),
      () => {
        const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
        try {
          const sources = sourcesFor(store, 'ops');
          declareSourceEdge(store, {
            id: 'rel-test',
            workspace: 'ops',
            from: sources[0]!.id,
            to: sources[1]!.id,
            relation: 'governs',
            note: '',
            declaredAt: '2026-09-01T00:00:00.000Z',
          });
          declareSourceWatch(store, {
            id: 'srcwatch-test',
            workspace: 'ops',
            source: sources[0]!.id,
            host: null,
            everyMinutes: 60,
            declaredAt: '2026-09-01T00:00:00.000Z',
          });
        } finally {
          store.close();
        }
        return 0;
      },
      () => source(['relations', '--workspace=ops']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /divergence inert: directory source at .*repo.* has no active watch/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('watch add states which relations became checkable and which stay inert', () => {
  const left = ground('left');
  const right = ground('right');
  try {
    let leftId = '';
    let rightId = '';
    const { code, out } = run([
      () => {
        const c1 = source(['add', '--kind=directory', `--locator=${left}`, '--workspace=ops']);
        const c2 = source(['add', '--kind=directory', `--locator=${right}`, '--workspace=ops']);
        return c1 !== 0 ? c1 : c2;
      },
      () => {
        const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
        try {
          const rows = sourcesFor(store, 'ops');
          leftId = rows.find((r) => r.locator === left)!.id;
          rightId = rows.find((r) => r.locator === right)!.id;
          declareSourceEdge(store, {
            id: 'rel-pair',
            workspace: 'ops',
            from: leftId,
            to: rightId,
            relation: 'depends-on',
            note: '',
            declaredAt: '2026-09-01T00:00:00.000Z',
          });
        } finally {
          store.close();
        }
        return 0;
      },
      () => watch(['add', `--source=${leftId}`, '--every=1h']),
      () => watch(['add', `--source=${rightId}`, '--every=1h']),
    ]);
    assert.equal(code, 0);
    assert.match(out, /still divergence-inert until the other end is watched/);
    assert.match(out, /divergence now checkable on:/);
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});
