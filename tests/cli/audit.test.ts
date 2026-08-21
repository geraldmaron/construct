/**
 * tests/cli/audit.test.ts — `construct audit` against a real declared source
 * and a real fixture consumer repo on disk, through the actual CLI surface.
 *
 * The properties held here are the ones a person acting on the filed queue
 * depends on: a repo missing a gate produces a proposal and a repo already
 * carrying it produces none, every proposal carries a citation back to a real
 * file under the declared source's own locator, nothing is decided by
 * auditing, and a second audit of the same repo files nothing twice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { addSource, decisionOf, pendingProposals } from '../../src/kernel/store/sources.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(steps: ReadonlyArray<string[] | (() => Promise<number> | number)>): Promise<Capture> {
  const dataRoot = mkdtempSync(join(tmpdir(), 'construct-audit-cli-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(dataRoot, 'share');
  process.env.XDG_CACHE_HOME = join(dataRoot, 'cache');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of steps) code = typeof step === 'function' ? await step() : await main(step);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

/** A fixture consumer repo carrying none of the audited gates. */
function repoMissingEverything(): string {
  const root = mkdtempSync(join(tmpdir(), 'construct-consumer-'));
  writeJson(join(root, 'package.json'), {
    name: 'consumer-fixture',
    scripts: { build: 'tsc', test: 'node --test' },
    devDependencies: { typescript: '^5.9.0' },
  });
  return root;
}

/** The same shape of repo, but already carrying every gate. */
function repoCarryingEverything(): string {
  const root = mkdtempSync(join(tmpdir(), 'construct-consumer-'));
  writeJson(join(root, 'package.json'), {
    name: 'consumer-fixture',
    scripts: {
      'test:a11y': 'jest --config a11y.jest.config.js',
      'test:security': 'audit-ci --moderate',
      lint: 'eslint . --max-warnings=0',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: { typescript: '^5.9.0' },
  });
  writeFileSync(join(root, '.eslintrc.json'), '{}');
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  return root;
}

function declareDirectorySource(locator: string, id = 'consumer-repo'): () => number {
  return () => {
    const store = openStore(storePath(resolvePaths()));
    try {
      addSource(store, { id, workspace: 'default', kind: 'directory', locator, addedAt: new Date().toISOString() });
    } finally {
      store.close();
    }
    return 0;
  };
}

test('a repo missing every gate produces a cited, risk-tiered proposal for each', async () => {
  const consumerRoot = repoMissingEverything();
  let pending: ReturnType<typeof pendingProposals> = [];
  let decided = 0;
  try {
    const { code, out } = await run([
      declareDirectorySource(consumerRoot),
      () => main(['audit', '--source=consumer-repo']),
      () => {
        const store = openStore(storePath(resolvePaths()));
        try {
          pending = pendingProposals(store, 'default');
          decided = pending.filter((p) => decisionOf(store, p.id) !== null).length;
        } finally {
          store.close();
        }
        return 0;
      },
    ]);

    assert.equal(code, 0);
    assert.equal(pending.length, 5, 'one proposal per missing gate');
    assert.equal(decided, 0, 'auditing decides nothing');

    for (const proposal of pending) {
      assert.equal(proposal.source, 'consumer-repo');
      // Every citation names a real file under the fixture root that was
      // actually read, not an invented one.
      assert.ok(
        proposal.justification.startsWith(consumerRoot),
        `${proposal.justification} does not cite a file under ${consumerRoot}`,
      );
    }
    assert.deepEqual(
      pending.map((p) => p.risk).sort(),
      ['high', 'low', 'low', 'low', 'low'],
    );
    assert.match(out, /no CI configuration found/);
    assert.match(out, /filed 5 proposal\(s\) against directory /);
    assert.match(out, /Nothing was written to that repository/);
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('a repo already carrying every gate produces no proposals', async () => {
  const consumerRoot = repoCarryingEverything();
  let pending: ReturnType<typeof pendingProposals> = [];
  try {
    const { code, out } = await run([
      declareDirectorySource(consumerRoot),
      () => main(['audit', '--source=consumer-repo']),
      () => {
        const store = openStore(storePath(resolvePaths()));
        try {
          pending = pendingProposals(store, 'default');
        } finally {
          store.close();
        }
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.equal(pending.length, 0);
    assert.match(out, /5 of 5 checked gate\(s\) enabled, 0 missing/);
    assert.match(out, /filed 0 proposal\(s\) against directory /);
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('auditing the same repo twice files nothing twice', async () => {
  const consumerRoot = repoMissingEverything();
  let count = -1;
  try {
    const { out } = await run([
      declareDirectorySource(consumerRoot),
      () => main(['audit', '--source=consumer-repo']),
      () => main(['audit', '--source=consumer-repo']),
      () => {
        const store = openStore(storePath(resolvePaths()));
        try {
          count = pendingProposals(store, 'default').length;
        } finally {
          store.close();
        }
        return 0;
      },
    ]);
    assert.equal(count, 5);
    assert.match(out, /filed 0 proposal\(s\).*5 already proposed/s);
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('--dry-run shows the audit and files nothing', async () => {
  const consumerRoot = repoMissingEverything();
  let count = -1;
  try {
    const { out } = await run([
      declareDirectorySource(consumerRoot),
      () => main(['audit', '--source=consumer-repo', '--dry-run']),
      () => {
        const store = openStore(storePath(resolvePaths()));
        try {
          count = pendingProposals(store, 'default').length;
        } finally {
          store.close();
        }
        return 0;
      },
    ]);
    assert.equal(count, 0);
    assert.match(out, /nothing was filed: --dry-run/);
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test('a declared source whose locator no longer exists on disk is reported unreachable, not crashed on', async () => {
  const goneRoot = repoMissingEverything();
  rmSync(goneRoot, { recursive: true, force: true });
  const { code, err } = await run([
    declareDirectorySource(goneRoot),
    () => main(['audit', '--source=consumer-repo']),
  ]);
  assert.equal(code, 1);
  assert.match(err, new RegExp(`audit: ${goneRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('a source the workspace never declared is refused, with the ones it did declare named', async () => {
  const { code, err } = await run([
    declareDirectorySource(repoMissingEverything()),
    () => main(['audit', '--source=nowhere']),
  ]);
  assert.equal(code, 1);
  assert.match(err, /declares no source nowhere/);
});

test('a non-repo source kind is refused rather than silently skipped', async () => {
  const { code, err } = await run([
    () => {
      const store = openStore(storePath(resolvePaths()));
      try {
        addSource(store, { id: 'jira-1', workspace: 'default', kind: 'jira', locator: 'PROJ', addedAt: new Date().toISOString() });
      } finally {
        store.close();
      }
      return 0;
    },
    () => main(['audit', '--source=jira-1']),
  ]);
  assert.equal(code, 1);
  assert.match(err, /a jira source/);
});
