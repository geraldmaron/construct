/**
 * tests/scripts/lint-doc-commands.test.ts — the doc-command gate's two halves:
 * how a usage block is read into a surface (pure classification, tested
 * directly), and whether the real lint fires on a documented command nobody
 * can run and stays quiet on one they can.
 *
 * The second half plants a fixture page in a scratch git repository this test
 * owns alone, not in this repo's own docs/ directory. The lint finds pages
 * through `git ls-files`, which needs a working tree to answer from and has
 * nothing to say about a bare tmpdir — so the fixture root is a freshly
 * `git init`ed tmpdir, passed to the lint as the root argument it now
 * accepts. Writing the fixture straight into docs/lint-doc-commands-fixture.md
 * and deleting it, as an earlier version of this test did, raced concurrent
 * lint runs from other sessions over the same path.
 *
 * The failing cases are the ones that shipped. `construct lessons list` was in
 * the first-run walkthrough and names a subcommand that has never existed;
 * catching it is the whole reason this gate exists, and an earlier version of
 * the check passed it, so it is pinned here rather than trusted.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// @ts-expect-error — the prober is plain .mjs, deliberately outside src/
import { probeSurface } from '../../scripts/lib/cli-surface.mjs';

type Surface = { shape: string; subcommands: Set<string> };

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-doc-commands.mjs', import.meta.url));

/**
 * A scratch git repository holding nothing but this file's fixture page.
 * `git init` gives `git ls-files` — the real lint's own discovery mechanism —
 * a working tree to answer from; nothing here is ever committed, since
 * `-co --exclude-standard` already reports an untracked, unignored file as
 * one of its own. One directory for the whole file, matching the original
 * design of one fixture path reused test to test, now pointed away from the
 * repository every other session and gate run shares.
 */
const DOCROOT = mkdtempSync(join(tmpdir(), 'construct-lint-doc-commands-'));
execFileSync('git', ['init', '--quiet'], { cwd: DOCROOT });
after(() => rmSync(DOCROOT, { recursive: true, force: true }));

const FIXTURE = join(DOCROOT, 'fixture.md');

async function runLint(): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [LINT, DOCROOT], { cwd: REPO });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? '' };
  }
}

async function withPage(body: string, check: (r: { code: number; stderr: string }) => void) {
  writeFileSync(FIXTURE, body);
  try {
    check(await runLint());
  } finally {
    rmSync(FIXTURE, { force: true });
  }
}

test('probing writes nothing into the repository', () => {
  // The probe runs real verbs, and some of them write relative to the working
  // directory. Redirecting HOME alone left a read-only check regenerating
  // tracked files on every commit.
  const pack = join(REPO, '.claude', 'skills');
  const before = existsSync(pack) ? statSync(pack).mtimeMs : null;
  probeSurface(['skills', 'source', 'outcome']);
  const after = existsSync(pack) ? statSync(pack).mtimeMs : null;
  assert.equal(after, before, '.claude/skills was touched by a read-only probe');
});

test('the surface is the same from any working directory', () => {
  const fromRoot = probeSurface(['source']) as Map<string, Surface>;
  const cwd = process.cwd();
  try {
    process.chdir(join(REPO, 'docs'));
    const fromElsewhere = probeSurface(['source']) as Map<string, Surface>;
    assert.equal(fromElsewhere.get('source')?.shape, fromRoot.get('source')?.shape);
    assert.deepEqual(
      [...(fromElsewhere.get('source')?.subcommands ?? [])].sort(),
      [...(fromRoot.get('source')?.subcommands ?? [])].sort(),
    );
  } finally {
    process.chdir(cwd);
  }
});

test('a verb that swallows an unknown positional still yields its subcommands', () => {
  // `routine` prints usage for a bad subcommand; the probe must still learn
  // the closed set. Missing this made invented subcommands pass the doc lint.
  const surface = probeSurface(['routine']) as Map<string, Surface>;
  assert.equal(surface.get('routine')?.shape, 'subcommands');
  for (const sub of ['create', 'list', 'enable', 'disable', 'run']) {
    assert.ok(surface.get('routine')?.subcommands.has(sub), `routine should accept ${sub}`);
  }
});

test('a verb whose usage ends in free text is positional, not flag-driven', () => {
  // `construct outcome [--flags…] "<what you want>"` opens with flags and ends
  // with the argument. Reading only the first token called it flags-only and
  // rejected `construct outcome ship the docs`, which works.
  for (const verb of ['outcome', 'ask']) {
    const surface = probeSurface([verb]) as Map<string, Surface>;
    assert.equal(surface.get(verb)?.shape, 'positional', `${verb} takes free text`);
  }
});

test('a verb with a closed subcommand set reports it', () => {
  const surface = probeSurface(['source']) as Map<string, Surface>;
  const source = surface.get('source');
  assert.equal(source?.shape, 'subcommands');
  for (const sub of ['add', 'list', 'retire']) {
    assert.ok(source?.subcommands.has(sub), `source should accept ${sub}`);
  }
});

test('a flag-driven verb is recorded as taking no subcommand, not as unknown', () => {
  // The distinction the first version of this check got wrong: an empty
  // subcommand set is a finding, not missing information.
  const surface = probeSurface(['lessons']) as Map<string, Surface>;
  assert.equal(surface.get('lessons')?.shape, 'flags-only');
  assert.equal(surface.get('lessons')?.subcommands.size, 0);
});

test('a verb taking a free positional is not judged on the word after it', () => {
  const surface = probeSurface(['decide']) as Map<string, Surface>;
  assert.equal(surface.get('decide')?.shape, 'positional');
});

test('a documented subcommand that does not exist fails the lint', async () => {
  await withPage('# fixture\n\n```bash\nconstruct lessons list\n```\n', (r) => {
    assert.equal(r.code, 1);
    assert.match(r.stderr, /lessons.*takes no subcommand.*'list'/);
  });
});

test('a documented subcommand outside a verb\'s set fails, and the set is shown', async () => {
  await withPage('# fixture\n\n```bash\nconstruct source bogus\n```\n', (r) => {
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no 'bogus' subcommand/);
    assert.match(r.stderr, /add, describe, list, relate, relations, retire, unrelate/);
  });
});

test('a documented verb that does not exist fails the lint', async () => {
  await withPage('# fixture\n\n```bash\nconstruct approve --id=7\n```\n', (r) => {
    assert.equal(r.code, 1);
    assert.match(r.stderr, /names no CLI verb \('approve'\)/);
  });
});

test('a documented flag the verb does not accept fails the lint', async () => {
  // Live CLI: `construct decide --id=… --resolution=…` exits 2 (unknown flag).
  // The same spelling used to ship as a recipe in CLI output.
  await withPage('# fixture\n\n```bash\nconstruct decide --id=dec-1 --resolution=yes\n```\n', (r) => {
    assert.equal(r.code, 1);
    assert.match(r.stderr, /does not accept --id/);
    assert.match(r.stderr, /does not accept --resolution/);
  });
});

test('real commands pass: a subcommand, a positional, and flags', async () => {
  const page = [
    '# fixture',
    '',
    '```bash',
    'construct source add --kind=git --locator=.',
    'construct plan run-20260821182404184',
    'construct lessons --admit=lesson-1 --by=someone',
    'construct decide dec-9 "yes"',
    '```',
    '',
    'Inline, as a reader would copy it: `construct doctor`.',
    '',
  ].join('\n');
  await withPage(page, (r) => {
    assert.equal(r.code, 0, r.stderr);
  });
});

test('prose and output transcripts are not commands', async () => {
  // A fence with no shell tag is a transcript or a diagram; the word appearing
  // inside one must not be read as something to run.
  const page = [
    '# fixture',
    '',
    '```',
    'ok   paths  state: /home/someone/.local/state/construct',
    'construct compounds its method record over time',
    '```',
    '',
    'Prose naming construct approve outside any code span is not a command.',
    '',
  ].join('\n');
  await withPage(page, (r) => {
    assert.equal(r.code, 0, r.stderr);
  });
});
