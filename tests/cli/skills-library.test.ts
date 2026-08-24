/**
 * tests/cli/skills-library.test.ts — the shipped method skills carried into a
 * host's skills directory: copied byte for byte, reported from the disk rather
 * than from any record of what was written, and removed without a trace.
 *
 * Everything happens inside a tmpdir, including the default-location case,
 * which runs with HOME moved so that "the personal skills directory" is never
 * anyone's real one. The checks are the observable ones: SHA-256 equality for
 * a copy, the presence or absence of files for a write, and exit codes for a
 * refusal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/index.ts';
import { readReachableSkills } from '../../src/cli/skills.ts';
import { SHIPPED_SKILLS } from '../../src/kernel/skills/library.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES } from '../../src/kernel/paths.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly root: string;
}

const SOURCE_DIR = fileURLToPath(new URL('../../skills/', import.meta.url));

/** The skills this checkout ships, read the way a reader would: from the tree. */
function shipped(): string[] {
  return readdirSync(SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SOURCE_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function checksum(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Run CLI steps against one throwaway directory, with the real home out of
 * reach — HOME is what the default install directory is resolved from, so a
 * test that forgot to move it would install into the person running it.
 */
async function run(steps: (root: string) => ReadonlyArray<string[]>): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-skill-library-'));
  const previous = {
    home: process.env.HOME,
    data: process.env.XDG_DATA_HOME,
    cache: process.env.XDG_CACHE_HOME,
  };
  process.env.HOME = join(root, 'home');
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
    for (const [name, value] of [
      ['HOME', previous.home],
      ['XDG_DATA_HOME', previous.data],
      ['XDG_CACHE_HOME', previous.cache],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** The personal-tier default, under the moved home — where nothing may appear uninvited. */
function personalDir(root: string): string {
  return join(root, 'home', '.claude', 'skills');
}

test('list names every shipped skill with its description, and writes nothing', async () => {
  const result = await run(() => [['skills', 'list']]);
  try {
    assert.equal(result.code, 0);
    const names = shipped();
    assert.ok(names.length > 0);
    for (const name of names) assert.ok(result.out.includes(name), `${name} is listed`);
    assert.match(result.out, new RegExp(`skills: ${String(names.length)} shipped`));

    // The description is what makes a skill trigger at all, so the listing
    // carries it whole. Its first words are enough to prove it is there.
    const first = readFileSync(join(SOURCE_DIR, names[0], 'SKILL.md'), 'utf8');
    const opening = /^description:\s*(?:[>|][-+]?\s*\n\s*)?(.{20,40})/m.exec(first);
    assert.ok(opening, 'the shipped file carries a description');
    assert.ok(result.out.includes(opening[1].split(/\s+/).slice(0, 3).join(' ')));

    // Looking is not installing.
    assert.equal(existsSync(join(result.root, 'home', '.claude')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('install writes a byte-identical copy, and the source it copied is unchanged', async () => {
  const name = shipped()[0];
  const source = join(SOURCE_DIR, name, 'SKILL.md');
  const before = checksum(source);
  const result = await run((root) => [
    ['skills', 'install', name, `--dir=${join(root, 'host')}`],
  ]);
  try {
    assert.equal(result.code, 0);
    const installed = join(result.root, 'host', name, 'SKILL.md');
    assert.equal(checksum(installed), before, 'the copy is the same bytes');
    assert.equal(checksum(source), before, 'the source was only read');
    assert.match(result.out, new RegExp(`installed ${name}`));
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('--dir installs there, and nothing lands in the personal directory', async () => {
  const name = shipped()[0];
  const result = await run((root) => [
    ['skills', 'install', name, `--dir=${join(root, 'host')}`],
  ]);
  try {
    assert.equal(result.code, 0);
    assert.ok(existsSync(join(result.root, 'host', name, 'SKILL.md')));
    assert.equal(existsSync(personalDir(result.root)), false);
    assert.equal(existsSync(join(result.root, 'home', '.claude')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('with no --dir the copy lands in the personal Agent Skills directory', async () => {
  const name = shipped()[0];
  const result = await run(() => [['skills', 'install', name]]);
  try {
    assert.equal(result.code, 0);
    const installed = join(personalDir(result.root), name, 'SKILL.md');
    assert.equal(checksum(installed), checksum(join(SOURCE_DIR, name, 'SKILL.md')));
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('--all carries every shipped skill, each one byte-identical', async () => {
  const names = shipped();
  const result = await run((root) => [['skills', 'install', '--all', `--dir=${join(root, 'host')}`]]);
  try {
    assert.equal(result.code, 0);
    for (const name of names) {
      assert.equal(
        checksum(join(result.root, 'host', name, 'SKILL.md')),
        checksum(join(SOURCE_DIR, name, 'SKILL.md')),
        `${name} was copied whole`,
      );
    }
    assert.match(result.out, new RegExp(`${String(names.length)} of ${String(names.length)} written`));
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('installed reads the disk: current, diverged, and absent are each reachable', async () => {
  const [first, second, third] = shipped();
  const result = await run((root) => {
    const dir = join(root, 'host');
    return [
      ['skills', 'install', first, second, `--dir=${dir}`],
      // Hand-editing one installed copy is the whole test for "never a cached
      // or source-derived value": the version reported has to follow the file.
      ['skills', 'installed', `--dir=${dir}`],
    ];
  });
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, new RegExp(`current\\s+${first}\\s+\\S+`));
    assert.match(result.out, new RegExp(`current\\s+${second}\\s+\\S+`));
    assert.match(result.out, new RegExp(`absent\\s+${third}\\s+-`));
    assert.match(result.out, /skills: 2 current, 0 diverged/);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('an installed copy edited by hand reports as diverged, at the version the file says', async () => {
  const name = shipped()[0];
  const result = await run((root) => {
    const dir = join(root, 'host');
    return [
      ['skills', 'install', name, `--dir=${dir}`],
      ['skills', 'installed', `--dir=${dir}`],
    ];
  });
  try {
    const dir = join(result.root, 'host');
    const installed = join(dir, name, 'SKILL.md');
    const sourceVersion = /^\s*version:\s*(.+)$/m.exec(readFileSync(installed, 'utf8'));
    assert.ok(sourceVersion, 'the shipped file carries a version');
    writeFileSync(
      installed,
      readFileSync(installed, 'utf8').replace(/^(\s*)version:.*$/m, '$1version: 9.9.9'),
    );

    const after = await run(() => [['skills', 'installed', `--dir=${dir}`]]);
    rmSync(after.root, { recursive: true, force: true });
    assert.equal(after.code, 0);
    assert.match(after.out, new RegExp(`diverged\\s+${name}\\s+9\\.9\\.9`));
    assert.match(after.out, /skills: 0 current, 1 diverged/);
    assert.equal(
      after.out.includes(`${name}  ${sourceVersion[1].trim()}`),
      false,
      'the version came from the installed file, not from the source',
    );
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('installed on a directory that does not exist says so and creates nothing', async () => {
  const result = await run((root) => [['skills', 'installed', `--dir=${join(root, 'absent')}`]]);
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, /which does not exist/);
    assert.match(result.out, /0 current, 0 diverged/);
    assert.equal(existsSync(join(result.root, 'absent')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('installed with no --dir does not create the personal directory either', async () => {
  const result = await run(() => [['skills', 'installed']]);
  try {
    assert.equal(result.code, 0);
    assert.equal(existsSync(join(result.root, 'home', '.claude')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('uninstall removes the folder whole and leaves the directory as it found it', async () => {
  const name = shipped()[0];
  const result = await run((root) => {
    const dir = join(root, 'host');
    // A directory that already holds someone else's skill: what uninstall
    // leaves behind has to be exactly this.
    mkdirSync(join(dir, 'hand-authored'), { recursive: true });
    writeFileSync(
      join(dir, 'hand-authored', 'SKILL.md'),
      '---\nname: hand-authored\ndescription: written by a person\n---\n\n# Mine\n',
    );
    return [
      ['skills', 'install', name, `--dir=${dir}`],
      ['skills', 'uninstall', name, `--dir=${dir}`],
      ['skills', 'installed', `--dir=${dir}`],
    ];
  });
  try {
    assert.equal(result.code, 0);
    const dir = join(result.root, 'host');
    assert.deepEqual(readdirSync(dir).sort(), ['hand-authored'], 'no trace of the install');
    assert.equal(existsSync(join(dir, name)), false);
    assert.match(result.out, new RegExp(`removed ${name} from `));
    assert.match(result.out, new RegExp(`absent\\s+${name}\\s+-`));
    // Somebody else's skill is counted where it sits, never claimed or listed
    // as one of this checkout's.
    assert.match(result.out, /1 other skill folder\(s\) there, none of them this checkout's/);
    assert.equal(result.out.includes('hand-authored'), false);
    assert.ok(
      readFileSync(join(dir, 'hand-authored', 'SKILL.md'), 'utf8').includes('written by a person'),
    );
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('uninstall of a skill that is not installed removes nothing and says so', async () => {
  const name = shipped()[0];
  const result = await run((root) => {
    const dir = join(root, 'host');
    mkdirSync(dir, { recursive: true });
    return [['skills', 'uninstall', name, `--dir=${dir}`]];
  });
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, new RegExp(`nothing to remove — ${name} is not installed`));
    assert.deepEqual(readdirSync(join(result.root, 'host')), []);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('uninstall keeps a folder holding files an install never wrote', async () => {
  const name = shipped()[0];
  const result = await run((root) => [
    ['skills', 'install', name, `--dir=${join(root, 'host')}`],
  ]);
  try {
    const dir = join(result.root, 'host');
    writeFileSync(join(dir, name, 'NOTES.md'), 'notes a person added\n');
    const kept = await run(() => [['skills', 'uninstall', name, `--dir=${dir}`]]);
    rmSync(kept.root, { recursive: true, force: true });
    assert.equal(kept.code, 1);
    assert.match(kept.err, /NOTES\.md/);
    assert.match(kept.err, /Nothing was removed/);
    assert.ok(existsSync(join(dir, name, 'SKILL.md')), 'the refusal removed nothing');
    assert.ok(existsSync(join(dir, name, 'NOTES.md')));
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('uninstall of a name this checkout does not ship names it and removes nothing', async () => {
  const result = await run((root) => {
    const dir = join(root, 'host');
    mkdirSync(join(dir, 'somebody-elses'), { recursive: true });
    writeFileSync(join(dir, 'somebody-elses', 'SKILL.md'), '---\nname: somebody-elses\n---\n');
    return [['skills', 'uninstall', 'somebody-elses', `--dir=${dir}`]];
  });
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /no skill named "somebody-elses"/);
    assert.ok(existsSync(join(result.root, 'host', 'somebody-elses', 'SKILL.md')));
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('install of a name that does not exist names it, writes nothing, and exits non-zero', async () => {
  const result = await run((root) => [
    ['skills', 'install', 'does-not-exist', `--dir=${join(root, 'host')}`],
  ]);
  try {
    assert.notEqual(result.code, 0);
    assert.match(result.err, /no skill named "does-not-exist"/);
    assert.equal(existsSync(join(result.root, 'host')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('install names nothing and asks for nothing is refused, not guessed at', async () => {
  const result = await run((root) => [['skills', 'install', `--dir=${join(root, 'host')}`]]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /usage: construct skills/);
    assert.equal(existsSync(join(result.root, 'host')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('installing what is already there rewrites nothing and says the copy is current', async () => {
  const name = shipped()[0];
  const result = await run((root) => {
    const dir = join(root, 'host');
    return [
      ['skills', 'install', name, `--dir=${dir}`],
      ['skills', 'install', name, `--dir=${dir}`],
    ];
  });
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, new RegExp(`current\\s+${name} — already byte-identical`));
    assert.match(result.out, /skills: 0 of 1 written/);
    assert.equal(
      checksum(join(result.root, 'host', name, 'SKILL.md')),
      checksum(join(SOURCE_DIR, name, 'SKILL.md')),
    );
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('a symlink planted at the install target is refused, never written through', async () => {
  const name = shipped()[0];
  const result = await run((root) => {
    const dir = join(root, 'host');
    const elsewhere = join(root, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    mkdirSync(dir, { recursive: true });
    return [['skills', 'install', name, `--dir=${dir}`]];
  });
  try {
    // The link is planted between the two runs so the first proves the path works.
    const dir = join(result.root, 'host');
    rmSync(join(dir, name), { recursive: true, force: true });
    symlinkSync(join(result.root, 'elsewhere'), join(dir, name));
    const refused = await run(() => [['skills', 'install', name, `--dir=${dir}`]]);
    rmSync(refused.root, { recursive: true, force: true });
    assert.equal(refused.code, 1);
    assert.match(refused.err, /is a symbolic link/);
    assert.deepEqual(readdirSync(join(result.root, 'elsewhere')), [], 'nothing crossed the link');
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('the subcommands are named in the usage line, beside the pack the verb also writes', async () => {
  const result = await run(() => [['skills', 'nonsense']]);
  try {
    assert.equal(result.code, 2);
    for (const line of ['skills list', 'skills install', 'skills installed', 'skills uninstall']) {
      assert.ok(result.err.includes(line), `${line} is in the usage`);
    }
    assert.match(result.err, /\[--out=<dir>\] \[--uninstall\]/);
    // A mistyped subcommand must not fall through to writing a pack.
    assert.equal(existsSync(join(result.root, '.claude')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('what a dispatch can reach is read from the directory it was given, never from home', () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-reach-'));
  try {
    mkdirSync(join(dir, 'written-voice'));
    writeFileSync(
      join(dir, 'written-voice', 'SKILL.md'),
      '---\nname: written-voice\ndescription: the copy this machine would load\n---\n\nbody\n',
    );
    // A folder nobody ships is left alone: the reader names what this project
    // ships, and describes each by the file that is actually there.
    mkdirSync(join(dir, 'somebody-elses-skill'));
    writeFileSync(join(dir, 'somebody-elses-skill', 'SKILL.md'), '---\nname: x\n---\n');

    const reachable = readReachableSkills(dir);
    assert.equal(reachable.installDir, dir);
    assert.deepEqual(
      reachable.offers.map((offer) => offer.name),
      [...SHIPPED_SKILLS].sort(),
      'every shipped skill is reachable from a checkout',
    );
    const installed = reachable.offers.filter((offer) => offer.reach === 'installed');
    assert.deepEqual(
      installed.map((offer) => [offer.name, offer.description]),
      [['written-voice', 'the copy this machine would load']],
      'the installed copy answers, described by its own text',
    );
    assert.ok(
      reachable.offers.every((offer) => offer.locator.startsWith(dir) || offer.reach === 'checkout'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--host installs into each host\'s own documented directory', async () => {
  const name = shipped()[0];
  for (const host of SKILLS_HOST_NAMES) {
    const result = await run((root) => [['skills', 'install', name, `--host=${host}`]]);
    try {
      assert.equal(result.code, 0, `install --host=${host} succeeded`);
      const expected = resolveHostSkillsDir(host, {
        HOME: join(result.root, 'home'),
      });
      assert.equal(
        checksum(join(expected, name, 'SKILL.md')),
        checksum(join(SOURCE_DIR, name, 'SKILL.md')),
        `${host} received a byte-identical copy at its documented directory`,
      );
    } finally {
      rmSync(result.root, { recursive: true, force: true });
    }
  }
});

test('--host=claude lands in the same place the default does', async () => {
  const name = shipped()[0];
  const result = await run(() => [['skills', 'install', name, '--host=claude']]);
  try {
    assert.equal(result.code, 0);
    assert.equal(
      checksum(join(personalDir(result.root), name, 'SKILL.md')),
      checksum(join(SOURCE_DIR, name, 'SKILL.md')),
    );
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('--host and --dir together are refused, naming both flags', async () => {
  const name = shipped()[0];
  const result = await run((root) => [
    ['skills', 'install', name, `--dir=${join(root, 'host')}`, '--host=cursor'],
  ]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /--dir and --host/);
    assert.match(result.err, /--dir=/);
    assert.match(result.err, /--host=cursor/);
    assert.equal(existsSync(join(result.root, 'host')), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('an unknown --host is refused and names the hosts that are known', async () => {
  const name = shipped()[0];
  const result = await run(() => [['skills', 'install', name, '--host=nonesuch']]);
  try {
    assert.equal(result.code, 2);
    assert.match(result.err, /no known host named "nonesuch"/);
    for (const host of SKILLS_HOST_NAMES) assert.match(result.err, new RegExp(host));
    assert.match(result.err, /--dir instead/);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('--host works the same way on installed and uninstall', async () => {
  const name = shipped()[0];
  const result = await run((root) => [
    ['skills', 'install', name, '--host=opencode'],
    ['skills', 'installed', '--host=opencode'],
    ['skills', 'uninstall', name, '--host=opencode'],
  ]);
  try {
    assert.equal(result.code, 0);
    assert.match(result.out, new RegExp(`current\\s+${name}`));
    assert.match(result.out, new RegExp(`removed ${name} from `));
    const dir = resolveHostSkillsDir('opencode', { HOME: join(result.root, 'home') });
    assert.equal(existsSync(join(dir, name)), false);
  } finally {
    rmSync(result.root, { recursive: true, force: true });
  }
});

test('codex resolves to the shared .agents directory, not one of its own', () => {
  const home = join('/nowhere', 'home');
  assert.equal(resolveHostSkillsDir('codex', { HOME: home }), join(home, '.agents', 'skills'));
});
