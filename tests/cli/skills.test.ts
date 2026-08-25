/**
 * tests/cli/skills.test.ts — the skills command through its real surface: it
 * writes a pack where it is told to, rewrites it in place byte for byte, and
 * removes only what it wrote.
 *
 * Everything happens inside a tmpdir, including the default-location case,
 * which runs with the working directory moved so that "beside the project"
 * never means beside this repository or anyone's home.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

/** Run CLI steps against one throwaway directory, with the real home out of reach. */
async function run(steps: (root: string) => ReadonlyArray<string[]>): Promise<Capture & { root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'construct-skills-'));
  const previousData = process.env.XDG_DATA_HOME;
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
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
  let code = 0;
  try {
    for (const step of steps(root)) code = await main(step);
    return { code, out: out.join(''), err: err.join(''), root };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousCache;
  }
}

function folders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const folder of folders(dir)) {
    files[folder] = readFileSync(join(dir, folder, 'SKILL.md'), 'utf8');
  }
  return files;
}

test('bare "construct skills" writes nothing — it only prints usage', async () => {
  const result = await run((root) => [['skills']]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /usage: construct skills/);
    assert.deepEqual(folders(result.root), []);
    assert.equal(result.out, '', 'a bare invocation never writes');
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('an unrecognized subcommand writes nothing — it only prints usage', async () => {
  const result = await run((root) => [['skills', 'generate', `--out=${join(root, 'pack')}`]]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /usage: construct skills/);
    assert.deepEqual(folders(result.root), []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('pack --out writes a stamped lens pack, and running it again rewrites the same bytes', async () => {
  const first = await run((root) => [['skills', 'pack', `--out=${join(root, 'pack')}`]]);
  try {
    assert.equal(first.code, 0);
    const dir = join(first.root, 'pack');
    const written = snapshot(dir);
    const names = Object.keys(written);
    assert.ok(names.length > 0);
    assert.ok(names.every((n) => n.startsWith('construct-')));
    assert.match(first.out, /skills: \d+ lens skill\(s\) written to /);
    assert.match(first.out, /construct skills pack --uninstall/);
    for (const name of names) {
      assert.match(written[name], /^\s+generator: construct$/m);
      assert.match(written[name], /^\s+version: \S+$/m);
      assert.match(first.out, new RegExp(`wrote ${name}/SKILL\\.md`));
    }

    // Rewriting in place, byte for byte, is what makes a stale pack fixable by
    // re-running rather than by diffing.
    const again = await run(() => [['skills', 'pack', `--out=${dir}`]]);
    assert.equal(again.code, 0);
    assert.deepEqual(snapshot(dir), written);
    rmSync(again.root, { recursive: true, force: true });
  } finally {
    rmSync(first.root, { recursive: true, force: true });
  }
});

test('pack --uninstall removes the generated folders and keeps everything else', async () => {
  const result = await run((root) => {
    const dir = join(root, 'pack');
    mkdirSync(join(dir, 'hand-authored'), { recursive: true });
    writeFileSync(
      join(dir, 'hand-authored', 'SKILL.md'),
      '---\nname: hand-authored\ndescription: written by a person\n---\n\n# Mine\n',
    );
    return [
      ['skills', 'pack', `--out=${dir}`],
      ['skills', 'pack', '--uninstall', `--out=${dir}`],
    ];
  });
  try {
    assert.equal(result.code, 0);
    const dir = join(result.root, 'pack');
    assert.deepEqual(folders(dir), ['hand-authored']);
    assert.match(result.out, /kept\s+hand-authored — no generation marker/);
    assert.match(result.out, /removed construct-compliance — generated by construct /);
    assert.match(result.out, /skills: removed \d+, kept 1 in /);
    assert.ok(
      readFileSync(join(dir, 'hand-authored', 'SKILL.md'), 'utf8').includes('written by a person'),
    );
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('pack --uninstall on a directory that was never written says so and changes nothing', async () => {
  const result = await run((root) => [
    ['skills', 'pack', '--uninstall', `--out=${join(root, 'absent')}`],
  ]);
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, /nothing to remove/);
    assert.deepEqual(folders(result.root), []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('pack with no --out lands beside the project, under .claude/skills', async () => {
  const previousCwd = process.cwd();
  const result = await run((root) => {
    process.chdir(root);
    return [['skills', 'pack']];
  });
  try {
    assert.equal(result.code, 0);
    assert.ok(folders(join(result.root, '.claude', 'skills')).includes('construct-security'));
  } finally {
    process.chdir(previousCwd);
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('a flag pack does not know is refused rather than guessed at', async () => {
  const result = await run((root) => [
    ['skills', 'pack', '--force', `--out=${join(root, 'pack')}`],
  ]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /usage: construct skills/);
    assert.deepEqual(folders(result.root), []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('the command is listed in the help surface', async () => {
  const result = await run(() => [['help']]);
  try {
    // Grouped now, one verb per line with a gloss, rather than a flat
    // pipe-delimited run of every verb.
    assert.match(result.out, /\n {2}skills {2,}\S/);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('a symlink planted under the output tree is refused by name, never written through', async () => {
  const { code, err, root } = await run((root) => {
    const out = join(root, 'skills');
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(out, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    // A checked-out repository can carry this: a pack folder that is really
    // a link pointing outside the directory the user named.
    symlinkSync(elsewhere, join(out, 'construct-analyst'));
    return [['skills', 'pack', `--out=${out}`]];
  });

  assert.equal(code, 1);
  assert.match(err, /construct-analyst is a symbolic link/);
  assert.match(err, /would land outside/);
  const elsewhere = join(root, 'elsewhere');
  assert.deepEqual(readdirSync(elsewhere), [], 'nothing crossed the link');
});

test('an output directory that is itself a symlink is refused, not followed', async () => {
  const { code, err } = await run((root) => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(elsewhere, join(root, 'linked-skills'));
    return [['skills', 'pack', `--out=${join(root, 'linked-skills')}`]];
  });

  assert.equal(code, 1);
  assert.match(err, /is a symbolic link/);
});

test('a planted parent of the default out (.claude as a link) is refused, not followed', async () => {
  const previousCwd = process.cwd();
  const result = await run((root) => {
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    // The repo-plant shape: the checkout carries `.claude` as a link, so the
    // default out resolves through it. lstat of out alone follows the parent
    // silently; the walk from the working directory sees it.
    symlinkSync(elsewhere, join(root, '.claude'));
    process.chdir(root);
    return [['skills', 'pack']];
  });
  try {
    assert.equal(result.code, 1);
    assert.match(result.err, /\.claude is a symbolic link/);
    assert.deepEqual(readdirSync(join(result.root, 'elsewhere')), [], 'nothing crossed the link');
  } finally {
    process.chdir(previousCwd);
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('a refusal writes nothing at all — no partial pack, however late the planted link sorts', async () => {
  const { code, root } = await run((root) => {
    const out = join(root, 'skills');
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(out, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    // construct-security sorts near the end of the pack; a per-file check
    // would have written everything before it.
    symlinkSync(elsewhere, join(out, 'construct-security'));
    return [['skills', 'pack', `--out=${out}`]];
  });

  assert.equal(code, 1);
  const entries = readdirSync(join(root, 'skills'));
  assert.deepEqual(entries, ['construct-security'], 'the planted link is all that exists');
});

test('--uninstall through a symlinked out is refused, and the real pack survives', async () => {
  const { code, err, root } = await run((root) => {
    const real = join(root, 'real-pack');
    symlinkSync(real, join(root, 'linked-pack'));
    return [
      ['skills', 'pack', `--out=${real}`],
      ['skills', 'pack', '--uninstall', `--out=${join(root, 'linked-pack')}`],
    ];
  });

  assert.equal(code, 1);
  assert.match(err, /linked-pack is a symbolic link/);
  assert.ok(folders(join(root, 'real-pack')).length > 0, 'nothing was removed through the link');
});
