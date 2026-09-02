/**
 * tests/scripts/lint-glossary-parity.test.ts — what the glossary lint can see
 *.
 *
 * The lint's correctness has two halves, and only one of them was ever tested
 * by running it: whether it recognises a retired term, and whether the file
 * carrying that term is in the set it walks at all. The second half failed
 * silently for two commits. Walking `git ls-files` alone meant a brand-new file
 * was invisible until `git add`, so the ordinary sequence — write, run the gate,
 * add, commit — ran the gate at the one moment the new file could not fail it.
 *
 * These tests are therefore about the WALK, not the vocabulary. A retired term
 * is planted in a file that has never been tracked, which is exactly the state
 * both escapes were in when the gate called them clean.
 *
 * The fixture is written into the real repo because that is the only place the
 * lint's git walk and its GLOSSARY.md agree about — a tmpdir has no git index
 * for `git ls-files` to answer from. It carries an unmistakable name and is
 * removed in a finally, so an interrupted run leaves something obvious rather
 * than something plausible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-glossary-parity.mjs', import.meta.url));

// Inside GLOSSARY_SCOPE (src/) and not matched by EXEMPT (it is not a .test.ts),
// so the only reason it could escape the lint is the walk itself.
const FIXTURE = fileURLToPath(new URL('../../src/__glossary-lint-fixture__.ts', import.meta.url));

/** Runs the lint as the gate runs it, returning the exit code and stderr. */
async function runLint(): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [LINT], { cwd: REPO });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? '' };
  }
}

test('a never-tracked file using a retired term fails the lint before it is added', async () => {
  // 'trunk' is the retired synonym for 'workflow' — and the exact term commit
  // 39da902 shipped to main through this hole.
  writeFileSync(FIXTURE, 'export const shared = "the trunk every role draws on";\n');
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1, 'lint should exit non-zero on an untracked violation');
    assert.match(stderr, /__glossary-lint-fixture__/);
    assert.match(stderr, /retired term "trunk"/);
    assert.match(stderr, /use "workflow"/);
  } finally {
    rmSync(FIXTURE, { force: true });
  }
});

test('the fixture is what makes the lint fail, not the repo', async () => {
  // Guards the test above from passing for the wrong reason: if main were
  // already red, the assertion on exit code 1 would prove nothing about the
  // walk. This also pins the lint clean on the tree under review.
  assert.equal(existsSync(FIXTURE), false, 'a previous run left its fixture behind');
  const { code } = await runLint();
  assert.equal(code, 0, 'the repo itself has a glossary violation — fix that first');
});
