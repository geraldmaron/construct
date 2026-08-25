/**
 * tests/cli/propose-triage.test.ts — inbound tracker issues deduped and
 * triaged through the real CLI surface.
 *
 * The property this whole surface exists for: only the low-risk annotation
 * proposals (label, comment) ever auto-apply, and only where the workspace
 * already holds standing write consent and a host is given — every one of
 * them leaves a decision row whose basis is standing-consent, the same
 * authority kernel/run/apply.ts already requires. The high-risk close
 * proposal a triage pass may also file never auto-applies regardless of
 * consent, exactly like any other high-risk proposal, and it never even
 * reaches the host, exactly like decide.ts's own apply path. Without a host,
 * or with a read-only one, nothing is carried out at all; `--dry-run` files
 * nothing; and re-running triage over the same issues refiles nothing
 * already waiting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consent, propose } from '../../src/cli/index.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import {
  addSource,
  decisionOf,
  pendingProposals,
  setSourceDeclaration,
} from '../../src/kernel/store/sources.ts';
import { triageProposals } from '../../src/kernel/run/triage.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(fn: (root: string) => Promise<number> | number): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-propose-triage-'));
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
    code = await fn(root);
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

const AT = '2026-08-21T00:00:00.000Z';

function declareSource(id = 'src-1'): void {
  const store = openStore(storePath(resolvePaths()));
  try {
    addSource(store, { id, workspace: 'acme', kind: 'jira', locator: 'PROJ', addedAt: AT });
    // Standing consent reaches a source only once it is declared not sensitive;
    // without a declaration its safety is unknown and it waits for a person.
    setSourceDeclaration(
      store,
      id,
      { authority: 'working', relevance: 'the tracker', sensitive: false },
      AT,
    );
  } finally {
    store.close();
  }
}

/** Two issues whose titles are identical once normalized — an exact duplicate. */
const EXACT_DUP_ISSUES = [
  { id: 'PROJ-1', title: 'Dropdown menu closes unexpectedly' },
  { id: 'PROJ-2', title: 'Dropdown menu closes unexpectedly' },
];

function writeLiveFile(root: string, issues: unknown): string {
  const file = join(root, 'live.json');
  writeFileSync(file, JSON.stringify(issues));
  return file;
}

/** A host that can carry a change out, and counts how many times it was asked. */
function outwardHost(): HostAdapter & { readonly asked: () => number } {
  let asked = 0;
  return {
    name: 'stand-in',
    kind: 'coding',
    capabilities: ['outward-write'],
    init: async () => {},
    invoke: async (): Promise<HostResult> => {
      asked += 1;
      return {
        id: 'i-1',
        status: 'ok',
        output: { text: JSON.stringify({ applied: true, detail: 'done' }) },
        error: null,
      };
    },
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    asked: () => asked,
  };
}

/** A host with no outward-write capability, like the cursor/codex dispatch postures. */
function readOnlyHost(): HostAdapter {
  return {
    name: 'read-only-stand-in',
    kind: 'coding',
    capabilities: [],
    init: async () => {},
    invoke: async (): Promise<HostResult> => {
      throw new Error('a read-only host should never be asked to carry out a change');
    },
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
  };
}

test('naming no --live file is a usage error', async () => {
  const { code, err } = await run(async () => propose(['triage', '--source=src-1']));
  assert.equal(code, 2);
  assert.match(err, /reads a tracker's current issues from a file/);
});

test('an unreadable --live file is a clean error, not a crash', async () => {
  const { code, err } = await run(async (root) =>
    propose(['triage', '--source=src-1', `--live=${join(root, 'missing.json')}`]),
  );
  assert.equal(code, 1);
  assert.match(err, /cannot read tracker issues/);
});

test('a --live file that is not a JSON array is refused', async () => {
  const { code, err } = await run(async (root) => {
    const file = join(root, 'live.json');
    writeFileSync(file, JSON.stringify({ not: 'an array' }));
    return propose(['triage', '--source=src-1', `--live=${file}`]);
  });
  assert.equal(code, 1);
  assert.match(err, /JSON array of tracker issues/);
});

test('an issue entry with no id or no title is refused in plain language', async () => {
  const { code, err } = await run(async (root) => {
    const file = writeLiveFile(root, [{ title: 'no id here' }]);
    return propose(['triage', '--source=src-1', `--live=${file}`]);
  });
  assert.equal(code, 1);
  assert.match(err, /entry 0 names no string "id"/);
});

test('no duplicates among the live issues proposes nothing', async () => {
  const { code, out } = await run(async (root) => {
    declareSource();
    const file = writeLiveFile(root, [
      { id: 'PROJ-1', title: 'Add dark mode toggle to settings' },
      { id: 'PROJ-2', title: 'Export CSV report from dashboard' },
    ]);
    return propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`]);
  });
  assert.equal(code, 0);
  assert.match(out, /0 likely duplicate\(s\) among 2 issue\(s\)/);
  assert.match(out, /nothing to propose/);
});

test('--dry-run shows what would be proposed and files nothing', async () => {
  let pending = -1;
  const { code, out } = await run(async (root) => {
    declareSource();
    const file = writeLiveFile(root, EXACT_DUP_ISSUES);
    const result = await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`, '--dry-run']);
    const store = openStore(storePath(resolvePaths()));
    pending = pendingProposals(store, 'acme').length;
    store.close();
    return result;
  });
  assert.equal(code, 0);
  assert.equal(pending, 0, '--dry-run writes nothing to the store');
  assert.match(out, /nothing was filed: --dry-run shows what triage would propose/);
  // The preview still names the label, comment, and close rows.
  assert.match(out, /\[low, label]/);
  assert.match(out, /\[low, comment]/);
  assert.match(out, /\[high, update]/);
});

test('without a host, triage files proposals but carries nothing out', async () => {
  let pending = -1;
  const { code, out } = await run(async (root) => {
    declareSource();
    assert.equal(consent(['--workspace=acme', '--set=on']), 0);
    const file = writeLiveFile(root, EXACT_DUP_ISSUES);
    const result = await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`]);
    const store = openStore(storePath(resolvePaths()));
    pending = pendingProposals(store, 'acme').length;
    store.close();
    return result;
  });
  assert.equal(code, 0);
  assert.equal(pending, 3, 'label, comment and update all filed, none decided');
  assert.match(out, /no host carried anything out/);
});

test('a read-only host still files proposals, applies none, and says why', async () => {
  let pending = -1;
  const { code, err } = await run(async (root) => {
    declareSource();
    assert.equal(consent(['--workspace=acme', '--set=on']), 0);
    const file = writeLiveFile(root, EXACT_DUP_ISSUES);
    const result = await propose(
      ['triage', '--source=src-1', '--workspace=acme', `--live=${file}`],
      readOnlyHost(),
    );
    const store = openStore(storePath(resolvePaths()));
    pending = pendingProposals(store, 'acme').length;
    store.close();
    return result;
  });
  assert.equal(code, 0);
  assert.equal(pending, 3, 'a read-only host never gets the chance to apply anything');
  assert.match(err, /dispatches read-only, so it cannot carry a change out/);
});

test('re-running triage over the same issues refiles nothing already waiting', async () => {
  let filedTwice = -1;
  const { code, out } = await run(async (root) => {
    declareSource();
    const file = writeLiveFile(root, EXACT_DUP_ISSUES);
    assert.equal(await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`]), 0);
    const result = await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`]);
    const store = openStore(storePath(resolvePaths()));
    filedTwice = pendingProposals(store, 'acme').length;
    store.close();
    return result;
  });
  assert.equal(code, 0);
  assert.equal(filedTwice, 3, 'the second pass reaches the same three rows rather than doubling them');
  assert.match(out, /filed 0 proposal\(s\).*3 already proposed/s);
});

test(
  'with standing consent and a host: label and comment auto-apply under standing consent, ' +
    'the close proposal never even reaches the host and stays queued',
  async () => {
    const host = outwardHost();
    const expected = triageProposals({ source: 'src-1', locator: 'PROJ', issues: EXACT_DUP_ISSUES });
    assert.equal(expected.proposals.length, 3, 'label, comment, update');
    const [labelId, commentId, updateId] = expected.proposals.map((p) => p.id);

    let checked = false;
    const { code, out } = await run(async (root) => {
      declareSource();
      assert.equal(consent(['--workspace=acme', '--set=on']), 0);
      const file = writeLiveFile(root, EXACT_DUP_ISSUES);
      const result = await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`], host);

      // Inspected inside run()'s callback, before its finally block restores
      // XDG_DATA_HOME — the store this test wrote lives at the temp path, not
      // wherever the environment points once the harness has cleaned up.
      const store = openStore(storePath(resolvePaths()));
      const labelDecision = decisionOf(store, labelId!);
      const commentDecision = decisionOf(store, commentId!);
      const updateDecision = decisionOf(store, updateId!);
      store.close();

      assert.equal(labelDecision?.verdict, 'applied');
      assert.equal(labelDecision?.basis, 'standing-consent');
      assert.equal(commentDecision?.verdict, 'applied');
      assert.equal(commentDecision?.basis, 'standing-consent');
      assert.equal(updateDecision, null, 'the high-risk close was never even attempted, let alone applied');
      checked = true;

      return result;
    });

    assert.equal(code, 0);
    assert.ok(checked);
    assert.equal(host.asked(), 2, 'only the two low-risk rows ever reached the host');
    assert.match(out, /2 applied under standing consent, 1 left queued for a decision/);
  },
);

test('without standing consent, a host is never asked at all — everything waits for a person', async () => {
  const host = outwardHost();
  let pending = -1;
  const { code, out } = await run(async (root) => {
    declareSource();
    const file = writeLiveFile(root, EXACT_DUP_ISSUES);
    const result = await propose(['triage', '--source=src-1', '--workspace=acme', `--live=${file}`], host);
    const store = openStore(storePath(resolvePaths()));
    pending = pendingProposals(store, 'acme').length;
    store.close();
    return result;
  });
  assert.equal(code, 0);
  assert.equal(host.asked(), 0, 'standing consent is off, so even the low-risk rows never reach the host');
  assert.equal(pending, 3);
  assert.match(out, /0 applied under standing consent, 3 left queued for a decision/);
});
