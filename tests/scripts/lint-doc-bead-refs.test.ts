/**
 * tests/scripts/lint-doc-bead-refs.test.ts: whether a bead id cited in
 * documentation is checked against a real tracker export, and only that.
 *
 * Every test builds its own scratch git repository, carrying its own
 * docs/ tree and its own .beads/issues.jsonl, and never touches this repo's
 * real docs/ or tracker export. `git init` exists only to give `git
 * ls-files`, the lint's own discovery mechanism, a working tree to answer
 * from; nothing here is ever committed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-doc-bead-refs.mjs', import.meta.url));

interface Scratch {
  readonly root: string;
  write(relPath: string, body: string): void;
}

function scratchRepo(): Scratch {
  const root = mkdtempSync(join(tmpdir(), 'construct-lint-doc-bead-refs-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return {
    root,
    write(relPath, body) {
      const full = join(root, relPath);
      mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
      writeFileSync(full, body);
    },
  };
}

/** issues.jsonl, in the shape the real export uses: one JSON object per line. */
function withIssues(repo: Scratch, issues: ReadonlyArray<Record<string, unknown>>): void {
  repo.write('.beads/issues.jsonl', `${issues.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

const FIXTURE_ISSUES: ReadonlyArray<Record<string, unknown>> = [
  { _type: 'issue', id: 'construct-a1b', status: 'open' },
  { _type: 'issue', id: 'construct-ab12', status: 'open' },
  { _type: 'issue', id: 'construct-cd34', status: 'closed' },
  { _type: 'issue', id: 'construct-cd34.2', status: 'open' },
  { _type: 'memory', key: 'some-memory', value: 'no id field on a memory record' },
];

async function runLint(root: string): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [LINT, root], { cwd: REPO });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? '' };
  }
}

test('a doc citing an existing bead id passes, three-char and four-char alike', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('docs/fixture.md', '# fixture\n\nSee construct-a1b and construct-ab12 for context.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a doc citing an id the tracker has never heard of fails, naming the file, line, and token', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('docs/fixture.md', '# fixture\n\nline two\nSee construct-zzzz, which was never filed.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /docs\/fixture\.md:4/);
    assert.match(r.stderr, /construct-zzzz/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a closed bead is legitimate lineage, not rot', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('docs/fixture.md', 'Settled in construct-cd34.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a dotted child id is checked against its own record, not its parent\'s', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write(
      'docs/fixture.md',
      'construct-cd34.2 landed this. construct-cd34.9 did not (never filed).\n',
    );
    const r = await runLint(repo.root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /construct-cd34\.9/);
    assert.doesNotMatch(r.stderr, /construct-cd34\.2/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('construct-mcp is a product name, never a candidate id', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('docs/fixture.md', 'Configure the `construct-mcp` server key.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a root record is checked the same as a docs/ page', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('CHANGELOG.md', 'Fixed in construct-zzzz.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /CHANGELOG\.md:1/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a repository with no docs/ directory at all is still checked through its root records', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('README.md', 'Never filed: construct-zzzz.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /README\.md:1/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a missing tracker export fails loudly rather than passing on an empty id set', async () => {
  const repo = scratchRepo();
  try {
    repo.write('docs/fixture.md', 'No tracker export exists in this scratch repo yet.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /no tracker export/);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test('a page with no bead-shaped text at all passes trivially', async () => {
  const repo = scratchRepo();
  try {
    withIssues(repo, FIXTURE_ISSUES);
    repo.write('docs/fixture.md', '# fixture\n\nNothing here names a bead.\n');
    const r = await runLint(repo.root);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});
