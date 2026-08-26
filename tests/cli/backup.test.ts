/**
 * tests/cli/backup.test.ts — `construct backup` through the surface a person
 * types, not the kernel underneath.
 *
 * The wiring is what these hold: the verb reaches the store the rest of the
 * CLI uses, a refusal and a mismatch each leave through the exit code a script
 * can act on, and the two halves compose — a copy taken by one invocation is
 * checked by the next, and a copy that has been altered in between fails that
 * check instead of passing it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import { sterileAmbientEnv } from '../harness/sterile.ts';

sterileAmbientEnv();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/**
 * Run commands against one throwaway install. Both XDG roots move: the store
 * lives under the data dir and the record of copies under the state dir, and a
 * test that redirected only one would write into the real home.
 */
async function inFreshInstall(
  body: (context: { root: string; storeDir: string; run: (argv: string[]) => Promise<Capture> }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'construct-backup-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousState = process.env.XDG_STATE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_STATE_HOME = join(root, 'state');
  try {
    await body({
      root,
      storeDir: join(root, 'share', 'construct'),
      run: (argv) => capture(argv),
    });
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousState;
    rmSync(root, { recursive: true, force: true });
  }
}

async function capture(argv: string[]): Promise<Capture> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  try {
    const code = await main(argv);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

/** The only .db file in a directory — the copy a backup just wrote. */
function copyIn(dir: string): string {
  const names = readdirSync(dir).filter((name) => name.endsWith('.db'));
  assert.equal(names.length, 1, `expected one copy in ${dir}, found ${names.join(', ')}`);
  return join(dir, names[0] ?? '');
}

test('construct backup copies the store out of its own directory, and the copy verifies', async () => {
  await inFreshInstall(async ({ root, storeDir, run }) => {
    await run(['outcome', 'a run that leaves something worth keeping']);
    assert.ok(existsSync(join(storeDir, 'construct.db')), 'the store exists to be copied');

    const vault = join(root, 'vault');
    const taken = await run(['backup', vault]);
    assert.equal(taken.code, 0, taken.err);
    assert.match(taken.out, /backup: copied .*construct\.db to /);

    const copy = copyIn(vault);
    assert.ok(!copy.startsWith(storeDir), 'the copy is outside the store directory');

    const checked = await run(['backup', '--verify', copy]);
    assert.equal(checked.code, 0, checked.err);
    assert.match(checked.out, /matches the checksum recorded when the copy was taken/);
  });
});

test('construct backup --verify fails loudly on a copy that has been altered', async () => {
  await inFreshInstall(async ({ root, run }) => {
    await run(['outcome', 'a run that leaves something worth keeping']);
    const vault = join(root, 'vault');
    await run(['backup', vault]);
    const copy = copyIn(vault);

    const bytes = readFileSync(copy);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    writeFileSync(copy, bytes);

    const checked = await run(['backup', '--verify', copy]);
    assert.equal(checked.code, 1, 'a mismatch is not a success');
    assert.match(checked.err, /does not match the checksum recorded when the copy was taken/);
    assert.match(checked.err, /do not restore from it/);
    assert.ok(!/matches the checksum/.test(checked.out), 'and nothing on stdout claims otherwise');
  });
});

test('construct backup refuses a destination inside the store directory', async () => {
  await inFreshInstall(async ({ storeDir, run }) => {
    await run(['outcome', 'a run that leaves something worth keeping']);

    const inside = join(storeDir, 'copies');
    const refused = await run(['backup', inside]);
    assert.equal(refused.code, 2, 'a refusal is not a success');
    assert.match(refused.err, /resolves inside the store's own directory/);
    assert.equal(existsSync(inside), false, 'and nothing was written there');
  });
});

test('construct backup with no destination prints usage and refuses', async () => {
  await inFreshInstall(async ({ run }) => {
    const refused = await run(['backup']);
    assert.equal(refused.code, 2);
    assert.match(refused.err, /usage: construct backup <dir>/);
  });
});

test('construct backup --verify on a copy with no checksum beside it does not pass it', async () => {
  await inFreshInstall(async ({ root, run }) => {
    const loose = join(root, 'elsewhere', 'someone-elses.db');
    mkdirSync(join(root, 'elsewhere'), { recursive: true });
    writeFileSync(loose, 'bytes nobody recorded a checksum for\n');

    const checked = await run(['backup', '--verify', loose]);
    assert.equal(checked.code, 1);
    assert.match(checked.err, /cannot be verified, which is not the same as being intact/);
  });
});

test('construct backup before any store exists says so instead of creating one', async () => {
  await inFreshInstall(async ({ root, storeDir, run }) => {
    const refused = await run(['backup', join(root, 'vault')]);
    assert.equal(refused.code, 2);
    assert.match(refused.err, /there is no store at .* yet — nothing to copy/);
    assert.equal(existsSync(storeDir), false, 'asking to back up brings no store into existence');
  });
});
