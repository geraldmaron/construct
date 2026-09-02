/**
 * tests/scripts/lint-doc-commands.test.ts — a documented command is one the
 * CLI accepts, judged against the command registry itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFileSync } from 'node:child_process';

const execFileAsync = promisify(execFile);
const LINT = fileURLToPath(new URL('../../scripts/lint-doc-commands.mjs', import.meta.url));

function repoWith(markdown: string): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-doc-lint-'));
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'guide.md'), markdown, 'utf8');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function lint(root: string): Promise<{ code: number; err: string }> {
  try {
    await execFileAsync(process.execPath, [LINT, root]);
    return { code: 0, err: '' };
  } catch (error) {
    const e = error as { code?: number; stderr?: string };
    return { code: e.code ?? 1, err: e.stderr ?? '' };
  }
}

test('real commands pass: a noun with subcommand, a bare command, and their flags', async () => {
  const { root, cleanup } = repoWith('Run `construct source add repo --kind=directory --purpose="files" --json`, then:\n\n```bash\nconstruct status --json\nconstruct config explain locale\nconstruct init --dry-run\n```\n');
  try {
    assert.equal((await lint(root)).code, 0);
  } finally {
    cleanup();
  }
});

test('a documented command that does not exist fails the lint', async () => {
  const { root, cleanup } = repoWith('```bash\nconstruct outcome "ship it"\n```\n');
  try {
    const r = await lint(root);
    assert.equal(r.code, 1);
    assert.match(r.err, /names no CLI command \('outcome'\)/);
  } finally {
    cleanup();
  }
});

test('a documented subcommand outside a noun’s set fails, and the set is shown', async () => {
  const { root, cleanup } = repoWith('Try `construct source watch repo`.\n');
  try {
    const r = await lint(root);
    assert.equal(r.code, 1);
    assert.match(r.err, /'source' has no 'watch' subcommand \(it accepts: add, list, refresh, relate, retire, show\)/);
  } finally {
    cleanup();
  }
});

test('a documented flag the command does not accept fails the lint', async () => {
  const { root, cleanup } = repoWith('```bash\nconstruct status --verbose\n```\n');
  try {
    const r = await lint(root);
    assert.equal(r.code, 1);
    assert.match(r.err, /'status' does not accept --verbose/);
  } finally {
    cleanup();
  }
});

test('prose and output transcripts are not commands', async () => {
  const { root, cleanup } = repoWith('When you run construct outcome nothing happens.\n\n```text\nconstruct outcome printed this once\n```\n');
  try {
    assert.equal((await lint(root)).code, 0);
  } finally {
    cleanup();
  }
});
