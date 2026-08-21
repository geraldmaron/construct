/**
 * tests/scripts/lint-terminal-escape.test.ts — the terminal-escape gate's two
 * load-bearing pieces: whether the pure violation-detection logic reads real
 * code shapes correctly (ternary conditions, nesting, multi-line concatenated
 * templates), tested directly; and whether the real CLI wiring — the git
 * walk, the exit code — actually fires on a real violation and stays quiet on
 * a real clean tree. The second half plants a fixture directly in this repo,
 * mirroring `lint-glossary-parity.test.ts`: the lint discovers files via
 * `git ls-files`, which has nothing to answer from inside an unrelated
 * tmpdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// @ts-expect-error — the script is plain .mjs, deliberately outside src/
import { violationsIn } from '../../scripts/lint-terminal-escape.mjs';

type Violation = { relPath: string; line: number; field: string };

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-terminal-escape.mjs', import.meta.url));

async function runLint(): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await execFileAsync(process.execPath, [LINT], { cwd: REPO });
    return { code: 0, stderr };
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? 1, stderr: e.stderr ?? '' };
  }
}

function write(relPath: string, content: string): void {
  const full = REPO + relPath;
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, content);
}

// ---------------------------------------------------------------------------
// Pure detection logic
// ---------------------------------------------------------------------------

test('violationsIn flags a known field bare-interpolated into a stdout write', () => {
  const text = "process.stdout.write(`the model said: ${finding.claim}\\n`);\n";
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'claim');
  assert.equal(violations[0].line, 1);
});

test('violationsIn flags a known field bare-interpolated into a stderr write', () => {
  const text = "process.stderr.write(`justification unclear: ${finding.body}\\n`);\n";
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'body');
});

test('violationsIn does not flag a field wrapped in escapeForTerminal', () => {
  const text = "process.stdout.write(`the model said: ${escapeForTerminal(finding.claim)}\\n`);\n";
  assert.deepEqual(violationsIn('src/cli/index.ts', text), []);
});

test('violationsIn does not flag a call with no template literal, once escaped', () => {
  const text = 'process.stdout.write(escapeForTerminal(finding.claim));\n';
  assert.deepEqual(violationsIn('src/cli/index.ts', text), []);
});

test('violationsIn flags a bare field in a call with no template literal at all', () => {
  // The plainest possible new print site — a bare property access handed
  // straight to write(), no backticks anywhere in the call.
  const text = 'process.stdout.write(finding.claim);\n';
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'claim');
});

test('violationsIn flags a bare field reached through string concatenation', () => {
  const text = "process.stdout.write('claim: ' + finding.claim + '\\n');\n";
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'claim');
});

test('violationsIn does not flag a field name it has never heard of', () => {
  const text = 'process.stdout.write(`${finding.someUnknownField}`);\n';
  assert.deepEqual(violationsIn('src/cli/index.ts', text), []);
});

test('violationsIn ignores a field access used only as a ternary condition', () => {
  // sourceRead.remediation reads this way in the real tree: the condition
  // decides which template literal runs, and only the branch is content.
  const text =
    "process.stdout.write(sourceRead.remediation ? `  ${escapeForTerminal(sourceRead.remediation)}\\n` : '');\n";
  assert.deepEqual(violationsIn('src/cli/index.ts', text), []);
});

test('violationsIn still flags a bare branch behind a ternary condition on the same field', () => {
  const text = "process.stdout.write(finding.claim ? `${finding.claim}` : 'nothing');\n";
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1, 'only the printed branch counts, not the condition');
  assert.equal(violations[0].field, 'claim');
});

test('violationsIn handles nested parens inside escapeForTerminal without losing the boundary', () => {
  const text =
    'process.stderr.write(`failed: ${escapeForTerminal((error as Error).message)} — ${finding.claim}\\n`);\n';
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1, 'the escaped cast must not swallow the later bare field');
  assert.equal(violations[0].field, 'claim');
});

test('violationsIn reads a multi-line call built from concatenated template literals', () => {
  const text = [
    'process.stdout.write(',
    '  `a: ${escapeForTerminal(finding.claim)}\\n` +',
    '    `b: ${finding.body}\\n`,',
    ');',
    '',
  ].join('\n');
  const violations: Violation[] = violationsIn('src/cli/index.ts', text);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'body');
  assert.equal(violations[0].line, 3);
});

test('violationsIn only looks at process.stdout.write / process.stderr.write, not other calls', () => {
  const text = 'console.log(`${finding.claim}`);\nlogger.write(`${finding.body}`);\n';
  assert.deepEqual(violationsIn('src/cli/index.ts', text), []);
});

// ---------------------------------------------------------------------------
// The real CLI, against real fixtures planted in this repo
// ---------------------------------------------------------------------------

const FIXTURE = 'src/cli/__terminal-escape-lint-fixture__.ts';

function cleanupFixture(): void {
  rmSync(REPO + FIXTURE, { force: true });
}

test('the fixture is what makes the lint fail, not the repo', async () => {
  cleanupFixture();
  assert.equal(existsSync(REPO + FIXTURE), false, 'a previous run left its fixture behind');
  const { code } = await runLint();
  assert.equal(code, 0, 'the repo itself has a terminal-escape violation — fix that first');
});

test('a bare known field interpolated into a stdout write fails the lint', async () => {
  write(
    FIXTURE,
    "export function report(finding: { claim: string }): void {\n" +
      '  process.stdout.write(`finding: ${finding.claim}\\n`);\n' +
      '}\n',
  );
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /__terminal-escape-lint-fixture__\.ts:2/);
    assert.match(stderr, /"\.claim" reaches a stdout\/stderr write unescaped/);
  } finally {
    cleanupFixture();
  }
});

test('a bare known field interpolated into a stderr write fails the lint', async () => {
  write(
    FIXTURE,
    "export function reportFailure(finding: { concern: string }): void {\n" +
      '  process.stderr.write(`concern: ${finding.concern}\\n`);\n' +
      '}\n',
  );
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /__terminal-escape-lint-fixture__\.ts:2/);
  } finally {
    cleanupFixture();
  }
});

test('the same field wrapped in escapeForTerminal keeps the lint clean', async () => {
  write(
    FIXTURE,
    "import { escapeForTerminal } from '../kernel/render/terminal.ts';\n\n" +
      'export function report(finding: { claim: string }): void {\n' +
      '  process.stdout.write(`finding: ${escapeForTerminal(finding.claim)}\\n`);\n' +
      '}\n',
  );
  try {
    const { code } = await runLint();
    assert.equal(code, 0, 'a properly escaped field must not be flagged');
  } finally {
    cleanupFixture();
  }
});

test('a new file with a bare field fails the lint before it is tracked by git', async () => {
  // Mirrors the untracked-file gap lint-glossary-parity.test.ts backstops:
  // plain `git ls-files` alone would leave this invisible until `git add`.
  write(
    FIXTURE,
    'export function report(finding: { body: string }): void {\n' +
      '  process.stdout.write(finding.body);\n' +
      '}\n',
  );
  try {
    assert.equal(existsSync(REPO + FIXTURE), true);
    const { code, stderr } = await runLint();
    assert.equal(code, 1, 'an untracked violation must still be caught');
    assert.match(stderr, /"\.body" reaches a stdout\/stderr write unescaped/);
  } finally {
    cleanupFixture();
  }
});

test('a bare field outside src/cli/ is not checked — the gate is scoped there on purpose', async () => {
  const outside = 'src/kernel/__terminal-escape-lint-fixture__.ts';
  write(outside, 'export function report(finding: { claim: string }): void {\n' +
    '  process.stdout.write(`${finding.claim}`);\n' +
    '}\n');
  try {
    const { code } = await runLint();
    assert.equal(code, 0, 'src/kernel is outside this lint\'s declared scope');
  } finally {
    rmSync(REPO + outside, { force: true });
  }
});
