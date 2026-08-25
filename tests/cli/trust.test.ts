/**
 * tests/cli/trust.test.ts — the project-settings trust gate.
 *
 * A `.construct/settings.json` checked out of a repository is its author's, not
 * the person running Construct — cloning a repository hands you whatever it
 * says — so it is inert until a person ratifies its exact bytes, per repository.
 * Five controls make that hold, each with a real-world analog it is built
 * against, and each is a test here:
 *
 *   1. RAW-BYTES HASH — the whole file bytes, not a normalized shape. MCPoison
 *      (CVE-2025-54136) hashed an identifier rather than the content, so an
 *      edit slipped past a prior approval; a whitespace-only change must re-block.
 *   2. GATE BEFORE EFFECTS — the check runs before any value informs a run.
 *      Claude Code (CVE-2025-59536) ran effects before its gate; an unratified
 *      file must have zero effect on a resolved setting.
 *   3. SYMLINK REFUSED — a link anywhere in the path is refused, never followed.
 *   4. NO CROSS-REPO-BOUNDARY DISCOVERY — only the current repository's own file
 *      binds; the walk never climbs into a parent tree, and a world-writable or
 *      unbounded location is refused (a /tmp/.construct must not bind a /tmp run).
 *   5. CONSENT KEYS EXCLUDED BY CONSTRUCTION — the closed schema refuses a
 *      consent key in a file whatever the trust state, so a file can never carry
 *      one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import {
  discoverProjectSettings,
  hashSettingsBytes,
  resolveSettings,
} from '../../src/cli/settings-file.ts';
import type { ResolveInputs } from '../../src/cli/settings-file.ts';
import type { Paths } from '../../src/kernel/paths.ts';

interface Repo {
  readonly home: string;
  readonly root: string;
  readonly cwd: string;
  readonly conDir: string;
  readonly file: string;
  writeFile(text: string): void;
  writeRemote(url: string): void;
  cleanup(): void;
}

/** A checkout with a git root, a nested working directory, and a home to floor at. */
function repo(): Repo {
  const home = mkdtempSync(join(tmpdir(), 'construct-trust-'));
  const root = join(home, 'repo');
  const cwd = join(root, 'nested', 'deep');
  const conDir = join(root, '.construct');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  return {
    home,
    root,
    cwd,
    conDir,
    file: join(conDir, 'settings.json'),
    writeFile(text) {
      mkdirSync(conDir, { recursive: true });
      writeFileSync(join(conDir, 'settings.json'), text);
    },
    writeRemote(url) {
      writeFileSync(
        join(root, '.git', 'config'),
        `[remote "origin"]\n\turl = ${url}\n`,
      );
    },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function ladderInputs(
  r: Repo,
  ratified: (repoIdentity: string, hash: string) => boolean,
): ResolveInputs {
  const paths: Paths = {
    configDir: join(r.home, 'config'),
    stateDir: join(r.home, 'state'),
    dataDir: join(r.home, 'data'),
    cacheDir: join(r.home, 'cache'),
  };
  return { paths, cwd: r.cwd, env: {}, flags: {}, home: r.home, ratified };
}

function hostOf(resolved: ReturnType<typeof resolveSettings>): { display: string; source: string } {
  const found = resolved.find((s) => s.key === 'host');
  assert.ok(found);
  return { display: found.display, source: found.source };
}

// ---------------------------------------------------------------------------
// Control 1 — raw-bytes hash (MCPoison, CVE-2025-54136)
// ---------------------------------------------------------------------------

test('control 1: the hash is over the raw bytes, so a whitespace-only edit re-blocks', () => {
  const r = repo();
  try {
    r.writeFile('{"host":"cursor"}');
    const first = discoverProjectSettings(r.cwd, r.home);
    assert.equal(first.outcome, 'found');
    assert.ok(first.outcome === 'found');

    // A trust grant for exactly these bytes admits the file.
    const ratified = new Set([first.hash]);
    assert.equal(hostOf(resolveSettings(ladderInputs(r, (_id, h) => ratified.has(h)))).source, 'project file');

    // The same JSON, one space added — semantically identical, different bytes.
    r.writeFile('{"host":"cursor" }');
    const second = discoverProjectSettings(r.cwd, r.home);
    assert.ok(second.outcome === 'found');
    assert.notEqual(second.hash, first.hash, 'a whitespace edit is a different raw-bytes hash');

    // The old grant no longer admits the changed file: it is blocked again.
    assert.equal(hostOf(resolveSettings(ladderInputs(r, (_id, h) => ratified.has(h)))).source, 'built-in default');
  } finally {
    r.cleanup();
  }
});

test('control 1: the hash is the sha-256 of the exact bytes on disk', () => {
  const r = repo();
  try {
    const text = '{"host":"claude"}';
    r.writeFile(text);
    const found = discoverProjectSettings(r.cwd, r.home);
    assert.ok(found.outcome === 'found');
    assert.equal(found.hash, hashSettingsBytes(Buffer.from(text, 'utf8')));
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Control 2 — gate before effects (Claude Code, CVE-2025-59536)
// ---------------------------------------------------------------------------

test('control 2: an unratified file that would win has zero effect on any resolved setting', () => {
  const r = repo();
  try {
    // A file that, if admitted, would set the host to cursor over every default.
    r.writeFile('{"host":"cursor","locale":"pt-BR"}');
    const resolved = resolveSettings(ladderInputs(r, () => false));
    // Every value resolves exactly as it would with no project file at all: the
    // gate ran before the file's values ever reached the ladder.
    assert.deepEqual(hostOf(resolved), { display: 'opencode', source: 'built-in default' });
    const locale = resolved.find((s) => s.key === 'locale');
    assert.deepEqual(
      { display: locale?.display, source: locale?.source },
      { display: 'en-US', source: 'built-in default' },
    );
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Control 3 — symlink refused
// ---------------------------------------------------------------------------

test('control 3: a settings.json that is a symbolic link is refused, not followed', () => {
  const r = repo();
  try {
    const elsewhere = join(r.home, 'evil.json');
    writeFileSync(elsewhere, '{"host":"cursor"}');
    mkdirSync(r.conDir, { recursive: true });
    symlinkSync(elsewhere, r.file);
    const found = discoverProjectSettings(r.cwd, r.home);
    assert.equal(found.outcome, 'refused');
    assert.ok(found.outcome === 'refused' && /symbolic link/.test(found.reason));
  } finally {
    r.cleanup();
  }
});

test('control 3: a .construct that is a symbolic link is refused', () => {
  const r = repo();
  try {
    const realDir = join(r.home, 'elsewhere');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'settings.json'), '{"host":"cursor"}');
    symlinkSync(realDir, r.conDir);
    const found = discoverProjectSettings(r.cwd, r.home);
    assert.equal(found.outcome, 'refused');
    assert.ok(found.outcome === 'refused' && /symbolic link/.test(found.reason));
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Control 4 — no cross-repo-boundary discovery
// ---------------------------------------------------------------------------

test('control 4: discovery stops at the inner repo and never reaches the outer tree', () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-trust-nested-'));
  try {
    // Outer repository with a settings file at its root.
    const outer = join(home, 'outer');
    mkdirSync(join(outer, '.git'), { recursive: true });
    mkdirSync(join(outer, '.construct'), { recursive: true });
    writeFileSync(join(outer, '.construct', 'settings.json'), '{"host":"cursor"}');
    // Inner repository nested inside it, and a working directory within that.
    const inner = join(outer, 'vendor', 'inner');
    const cwd = join(inner, 'src');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(inner, '.git'), { recursive: true });

    // The outer file is an ancestor, but it is across a repository boundary:
    // discovery floors at the inner git root and finds nothing.
    assert.equal(discoverProjectSettings(cwd, home).outcome, 'absent');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('control 4: a working directory under no repository and outside home discovers nothing', () => {
  // The vulnerability an unbounded walk creates: a /tmp/.construct binding a run
  // in /tmp. With no git root and a cwd outside home, there is no floor and no
  // fallback, so discovery refuses to climb.
  const scratch = mkdtempSync(join(tmpdir(), 'construct-trust-loose-'));
  try {
    mkdirSync(join(scratch, '.construct'), { recursive: true });
    writeFileSync(join(scratch, '.construct', 'settings.json'), '{"host":"cursor"}');
    const cwd = join(scratch, 'work');
    mkdirSync(cwd, { recursive: true });
    // home is elsewhere, so the scratch tree is under neither a repo nor home.
    const home = mkdtempSync(join(tmpdir(), 'construct-trust-home-'));
    try {
      assert.equal(discoverProjectSettings(cwd, home).outcome, 'absent');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

const uidBinds = typeof process.getuid === 'function' && process.getuid() !== 0;

test('control 4: discovery in a world-writable directory is refused', () => {
  const r = repo();
  try {
    r.writeFile('{"host":"cursor"}');
    // The directory holding .construct is writable by any user on the machine —
    // exactly where a planted file would sit.
    chmodSync(r.root, 0o777);
    try {
      const found = discoverProjectSettings(r.cwd, r.home);
      assert.equal(found.outcome, 'refused');
      assert.ok(found.outcome === 'refused' && /writable by any user/.test(found.reason));
    } finally {
      chmodSync(r.root, 0o755);
    }
  } finally {
    r.cleanup();
  }
});

test('control 4: a git worktree whose .git is a file is still discovered', () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-trust-worktree-'));
  try {
    const root = join(home, 'wt');
    const cwd = join(root, 'sub');
    mkdirSync(cwd, { recursive: true });
    // A worktree (and a submodule) records its git dir as a FILE, not a
    // directory. Discovery must still recognize the repository root.
    writeFileSync(join(root, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'settings.json'), '{"host":"cursor"}');
    const found = discoverProjectSettings(cwd, home);
    assert.equal(found.outcome, 'found');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('control 4: repo identity comes from the remote, so trust does not transfer to a clone elsewhere', () => {
  const r = repo();
  try {
    r.writeRemote('git@example.com:acme/app.git');
    r.writeFile('{"host":"cursor"}');
    const found = discoverProjectSettings(r.cwd, r.home);
    assert.ok(found.outcome === 'found');
    assert.equal(found.repoIdentity, 'remote:git@example.com:acme/app.git');
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Control 5 — consent keys excluded by construction
// ---------------------------------------------------------------------------

test('control 5: a project file carrying a consent key is refused whatever its trust state', () => {
  const r = repo();
  try {
    r.writeFile('{"consent":"on"}');
    // The closed schema refuses it at parse — the refusal does not wait on, or
    // depend on, the trust check, so a consent key can never ride a file in.
    assert.throws(
      () => discoverProjectSettings(r.cwd, r.home),
      (error: unknown) => error instanceof Error && /consent/.test(error.message),
    );
  } finally {
    r.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The ratify command and its prompt
// ---------------------------------------------------------------------------

interface CliResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function runCli(argv: string[], cwd: string, xdg: string): Promise<CliResult> {
  const savedCwd = process.cwd();
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) {
    savedEnv[key] = process.env[key];
    process.env[key] = join(xdg, key.toLowerCase());
  }
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  process.chdir(cwd);
  let code: number;
  try {
    code = await main(argv);
  } finally {
    process.chdir(savedCwd);
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { code, out: out.join(''), err: err.join('') };
}

test('construct trust shows the whole untrusted file and its path on a first ask, then trusts it', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    r.writeFile('{"host":"cursor","groundHints":["prefer the ADRs"]}');

    const shown = await runCli(['trust'], r.cwd, xdg);
    assert.equal(shown.code, 0);
    assert.match(shown.out, /not yet trusted/);
    assert.ok(shown.out.includes(r.file), 'the absolute path is named');
    assert.match(shown.out, /host = cursor/);
    assert.match(shown.out, /groundHints = prefer the ADRs/);
    assert.match(shown.out, /construct trust --ratify/);

    const done = await runCli(['trust', '--ratify'], r.cwd, xdg);
    assert.equal(done.code, 0);
    assert.match(done.out, /trusted/);

    // Now it reads as trusted, and the ladder applies it.
    const again = await runCli(['trust'], r.cwd, xdg);
    assert.match(again.out, /is trusted/);
    const settings = await runCli(['settings'], r.cwd, xdg);
    assert.match(settings.out, /host\s+cursor\s+\(file, project file\)/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('on a re-ask for a changed file at the same path, only the changed keys are shown', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    r.writeFile('{"host":"cursor","locale":"en-US"}');
    await runCli(['trust', '--ratify'], r.cwd, xdg);

    // Change only the host; the file's bytes change, so it is untrusted again.
    r.writeFile('{"host":"claude","locale":"en-US"}');
    const reask = await runCli(['trust'], r.cwd, xdg);
    assert.equal(reask.code, 0);
    assert.match(reask.out, /has changed/);
    assert.match(reask.out, /host = claude/);
    assert.ok(!/locale = /.test(reask.out), 'an unchanged key is not shown on a re-ask');
    assert.ok(reask.out.includes(r.file), 'the absolute path is named');
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('a different file at a different path in the same repository is named as different, not changed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-trust-diff-'));
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    // A repository with a stable remote identity, so trust keys on the remote
    // and a file at another path is recognized as the same repository's.
    const root = join(home, 'repo');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@example.com:acme/app.git\n');
    const deep = join(root, 'a', 'b');
    const cwd = join(deep, 'c');
    mkdirSync(cwd, { recursive: true });

    // First file, deep in the tree, ratified.
    mkdirSync(join(deep, '.construct'), { recursive: true });
    writeFileSync(join(deep, '.construct', 'settings.json'), '{"host":"cursor"}');
    await runCli(['trust', '--ratify'], cwd, xdg);

    // Now the deep file is gone and a different file governs from the repo root.
    rmSync(join(deep, '.construct'), { recursive: true, force: true });
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'settings.json'), '{"host":"claude"}');

    const reask = await runCli(['trust'], cwd, xdg);
    assert.equal(reask.code, 0);
    assert.match(reask.out, /different project settings file/);
    assert.ok(reask.out.includes(join(root, '.construct', 'settings.json')), 'names the file now in effect');
    assert.ok(reask.out.includes(join(deep, '.construct', 'settings.json')), 'names the previously trusted file');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('construct trust escapes a control byte in a shown value rather than printing it raw', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    // A ground hint carrying an escape sequence: it must reach the screen in its
    // visible form, never as a byte a terminal would act on.
    r.writeFile(JSON.stringify({ groundHints: ['prefer[31m the ADRs'] }));
    const shown = await runCli(['trust'], r.cwd, xdg);
    assert.equal(shown.code, 0);
    assert.ok(!shown.out.includes(''), 'the escape byte must not reach the screen');
    assert.match(shown.out, /\\x1b/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('construct trust reports a refused file on stderr with a nonzero code', { skip: !uidBinds }, async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    const elsewhere = join(r.home, 'evil.json');
    writeFileSync(elsewhere, '{"host":"cursor"}');
    mkdirSync(r.conDir, { recursive: true });
    symlinkSync(elsewhere, r.file);
    const result = await runCli(['trust'], r.cwd, xdg);
    assert.equal(result.code, 1);
    assert.match(result.err, /refused/);
    assert.match(result.err, /symbolic link/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The workspace binding — a ratified project file scopes a repo's sources and
// outcomes to a named workspace, so client work does not pool in the shared
// `default` every repository under one HOME would otherwise share.
// ---------------------------------------------------------------------------

test('a ratified project file binds the workspace, so a repo’s sources land there not in the shared default', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    r.writeFile('{"workspace":"acme"}');
    assert.equal((await runCli(['trust', '--ratify'], r.cwd, xdg)).code, 0);

    // With no --workspace typed, the add lands in the bound workspace, and the
    // shared-default warning does not fire because a binding scopes it.
    const added = await runCli(['source', 'add', '--kind=github', '--locator=acme/app'], r.cwd, xdg);
    assert.equal(added.code, 0);
    assert.match(added.out, /workspace acme/);
    assert.doesNotMatch(added.err, /shared 'default' workspace/);

    // list, also with no --workspace, reads the same bound workspace.
    const listed = await runCli(['source', 'list'], r.cwd, xdg);
    assert.match(listed.out, /acme\/app/);

    // The shared default is a different, empty workspace — the source did not leak into it.
    const inDefault = await runCli(['source', 'list', '--workspace=default'], r.cwd, xdg);
    assert.match(inDefault.out, /no sources declared for workspace default/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('source add in the shared default with nothing binding it warns before it lands', async () => {
  const r = repo(); // no .construct/settings.json, so nothing binds a workspace
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    const added = await runCli(['source', 'add', '--kind=github', '--locator=x/y'], r.cwd, xdg);
    assert.equal(added.code, 0);
    assert.match(added.err, /shared 'default' workspace, visible to every repo/);
    assert.match(added.err, /--workspace=<name> or bind one in \.construct\/settings\.json/);
    assert.match(added.out, /workspace default/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('outcome in the shared default with nothing binding it warns before it records', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    const recorded = await runCli(['outcome', 'tidy the documentation'], r.cwd, xdg);
    assert.equal(recorded.code, 0);
    assert.match(recorded.err, /shared 'default' workspace, visible to every repo/);
    assert.match(recorded.out, /^run /m);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('outcome under a ratified binding plans on that workspace and does not warn', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    r.writeFile('{"workspace":"acme"}');
    assert.equal((await runCli(['trust', '--ratify'], r.cwd, xdg)).code, 0);
    const recorded = await runCli(['outcome', 'tidy the documentation'], r.cwd, xdg);
    assert.equal(recorded.code, 0);
    assert.doesNotMatch(recorded.err, /shared 'default' workspace/);
    assert.match(recorded.out, /workspace "acme"/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('an explicit --workspace=default is a choice, so it does not warn', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    const added = await runCli(
      ['source', 'add', '--kind=github', '--locator=x/y', '--workspace=default'],
      r.cwd,
      xdg,
    );
    assert.equal(added.code, 0);
    assert.doesNotMatch(added.err, /shared 'default' workspace/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('source add on a directory path that is not there yet says so instead of returning silently', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    const added = await runCli(
      ['source', 'add', '--kind=directory', '--locator=/no/such/path/here', '--workspace=acme'],
      r.cwd,
      xdg,
    );
    assert.equal(added.code, 0);
    assert.match(added.out, /declared/);
    assert.match(added.err, /\/no\/such\/path\/here is not there yet/);
    assert.match(added.err, /checked when it is read/);
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A consent key in a project file is a clean one-line error at every command
// that opens the store, never an uncaught stack trace — opening the store
// resolves `state` through the same ladder, so the refusal surfaces early.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Trust grants live in the home store, so `construct trust` reports and revokes
// correctly even when `state: local` has redirected the operational store into
// the repository. Reading trust from the redirected store would ask a repo-local
// store about a grant it never held, and misreport a ratified file as untrusted.
// ---------------------------------------------------------------------------

function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

test('trust status and --revoke are correct even with state: local redirecting the working store', async () => {
  const home = mkdtempSync(join(tmpdir(), 'construct-trust-localstate-'));
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    // A real git checkout: the state: local refusal asks git whether the store
    // path is ignored and untracked, so a stubbed .git will not do.
    const root = join(home, 'repo');
    const cwd = join(root, 'sub');
    mkdirSync(cwd, { recursive: true });
    git(root, ['init', '-q']);
    // The repo-local store path is covered by the ignore rules, so state: local
    // is allowed to take effect once the file is trusted.
    writeFileSync(join(root, '.gitignore'), '.construct/state/\n');
    mkdirSync(join(root, '.construct'), { recursive: true });
    writeFileSync(join(root, '.construct', 'settings.json'), '{"state":"local"}');

    // Ratify the file. Nothing is local yet (the file is not trusted until now),
    // so this grant lands in the home store — the only store trust ever uses.
    assert.equal((await runCli(['trust', '--ratify'], cwd, xdg)).code, 0);

    // With the file trusted, state: local is active: a store-opening verb now
    // roots its store inside the repository, not under home.
    assert.equal((await runCli(['settings'], cwd, xdg)).code, 0);
    assert.ok(
      existsSync(join(root, '.construct', 'state', 'construct.db')),
      'state: local redirected the operational store into the repository',
    );

    // Trust still reads the home store, so the ratified file reports as trusted
    // rather than as an untrusted file the redirected store never heard of.
    const status = await runCli(['trust'], cwd, xdg);
    assert.equal(status.code, 0);
    assert.match(status.out, /is trusted/);

    // And a revoke reaches the same home-store grant, so it actually withdraws.
    const revoked = await runCli(['trust', '--revoke'], cwd, xdg);
    assert.equal(revoked.code, 0);
    assert.match(revoked.out, /withdrew trust/);

    const after = await runCli(['trust'], cwd, xdg);
    assert.match(after.out, /not yet trusted/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
  }
});

test('a consent-bearing key in a project file renders a clean one-line error, not a stack trace', async () => {
  const r = repo();
  const xdg = mkdtempSync(join(tmpdir(), 'construct-trust-xdg-'));
  try {
    // Open the store once with no project file so it exists — the crash only
    // arises once the store is present, because that is when locating it
    // resolves `state` through the ladder and meets the refused key.
    assert.equal((await runCli(['settings'], r.cwd, xdg)).code, 0);
    r.writeFile('{"consent":"on"}');

    for (const argv of [['settings'], ['trust'], ['trust', '--ratify']]) {
      const result = await runCli(argv, r.cwd, xdg);
      assert.equal(result.code, 1, `${argv.join(' ')} exits nonzero`);
      assert.match(result.err, /consent/, `${argv.join(' ')} names the offending key`);
      assert.match(result.err, /construct consent/, `${argv.join(' ')} points at where consent lives`);
      // No stack trace reaches the user: no source-file frames, no error class name.
      assert.doesNotMatch(result.err, /settings-file\.ts/, `${argv.join(' ')} shows no file frame`);
      assert.doesNotMatch(result.err, /\n\s+at /, `${argv.join(' ')} shows no stack frame`);
      assert.doesNotMatch(result.err, /SettingsError/, `${argv.join(' ')} shows no error class`);
    }
  } finally {
    r.cleanup();
    rmSync(xdg, { recursive: true, force: true });
  }
});
