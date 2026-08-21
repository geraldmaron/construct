/**
 * tests/scripts/lint-connector-gate.test.ts — the connector use/build gate's
 * two load-bearing pieces: whether an import specifier actually resolves
 * into the guarded tree (pure resolution logic, tested directly), and
 * whether the real CLI wiring — the git walk, the per-tree rules, the exit
 * code — actually fires on a real violation and stays quiet on a real clean
 * tree. The second half plants fixtures directly in this repo, mirroring
 * `lint-glossary-parity.test.ts`: the lint discovers files via `git
 * ls-files`, which has nothing to answer from inside an unrelated tmpdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
// @ts-expect-error — the script is plain .mjs, deliberately outside src/
import { extractImportSpecifiers, resolveRelativeImport, isUnderTree, violationsIn } from '../../scripts/lint-connector-gate.mjs';

type ImportSpec = { specifier: string; line: number };
type Violation = { relPath: string; line: number; specifier: string };

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const LINT = fileURLToPath(new URL('../../scripts/lint-connector-gate.mjs', import.meta.url));

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

function removeTree(relPath: string): void {
  rmSync(REPO + relPath, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Pure resolution logic
// ---------------------------------------------------------------------------

test('extractImportSpecifiers finds static, side-effect, and dynamic imports with line numbers', () => {
  const text = [
    "import { a } from '../a.ts';",
    "import '../side-effect.ts';",
    "export { b } from '../b.ts';",
    "const x = await import('../dynamic.ts');",
  ].join('\n');
  const specs: ImportSpec[] = extractImportSpecifiers(text);
  assert.deepEqual(
    specs.map((s) => s.specifier).sort(),
    ['../a.ts', '../b.ts', '../dynamic.ts', '../side-effect.ts'].sort(),
  );
  const bySpecifier = new Map(specs.map((s) => [s.specifier, s.line]));
  assert.equal(bySpecifier.get('../a.ts'), 1);
  assert.equal(bySpecifier.get('../side-effect.ts'), 2);
  assert.equal(bySpecifier.get('../b.ts'), 3);
  assert.equal(bySpecifier.get('../dynamic.ts'), 4);
});

test('extractImportSpecifiers finds the specifier of a multi-line import list', () => {
  const text = "import {\n  a,\n  b,\n} from '../multiline.ts';\n";
  const specs = extractImportSpecifiers(text);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].specifier, '../multiline.ts');
  assert.equal(specs[0].line, 4, 'the line the "from" clause actually sits on');
});

test('resolveRelativeImport resolves relative specifiers and passes bare ones through as null', () => {
  assert.equal(
    resolveRelativeImport('src/kernel/run/apply.ts', '../connectors/jira/client.ts'),
    'src/kernel/connectors/jira/client.ts',
  );
  assert.equal(resolveRelativeImport('src/kernel/index.ts', './run/apply.ts'), 'src/kernel/run/apply.ts');
  assert.equal(resolveRelativeImport('src/hosts/compose.ts', 'node:fs'), null);
  assert.equal(resolveRelativeImport('scripts/foo.mjs', 'some-npm-package'), null);
});

test('isUnderTree matches the tree and its descendants, never a same-prefixed sibling', () => {
  assert.equal(isUnderTree('src/connectors', 'src/connectors'), true);
  assert.equal(isUnderTree('src/connectors/jira/client.ts', 'src/connectors'), true);
  assert.equal(isUnderTree('src/connectors-legacy/x.ts', 'src/connectors'), false);
  assert.equal(isUnderTree('src/kernel/connectors/seam.ts', 'src/connectors'), false);
});

test('violationsIn flags an importer resolving into src/connectors and nothing else', () => {
  const text =
    "import { readJira } from '../../connectors/jira/client.ts';\nimport { Store } from '../store/open.ts';\n";
  // Two levels deep, matching real files like src/kernel/run/apply.ts — the
  // first import climbs out of src/kernel entirely (into src/connectors),
  // the second stays inside src/kernel (a sibling file) and must stay clean.
  const violations = violationsIn('src/kernel/run/apply.ts', text, 'importer');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, '../../connectors/jira/client.ts');
  assert.equal(violations[0].line, 1);
});

test('violationsIn on a connector file allows kernel and builtins, forbids everything else', () => {
  const text = [
    "import type { ConnectorRead } from '../../kernel/connectors/seam.ts';",
    "import { createHash } from 'node:crypto';",
    "import { createClaudeAdapter } from '../../hosts/claude/adapter.ts';",
    "import { otherVendor } from '../github/client.ts';",
  ].join('\n');
  const violations: Violation[] = violationsIn('src/connectors/jira/client.ts', text, 'connector');
  assert.deepEqual(
    violations.map((v) => v.specifier),
    ['../../hosts/claude/adapter.ts', '../github/client.ts'],
  );
});

// ---------------------------------------------------------------------------
// The real CLI, against real fixtures planted in this repo
// ---------------------------------------------------------------------------

const FIXTURES = {
  kernel: 'src/kernel/__connector-gate-lint-fixture__.ts',
  hosts: 'src/hosts/__connector-gate-lint-fixture__.ts',
  scripts: 'scripts/__connector-gate-lint-fixture__.mjs',
  bin: 'bin/__connector-gate-lint-fixture__.mjs',
  connector: 'src/connectors/__connector-gate-lint-fixture-vendor__/client.ts',
  cli: 'src/cli/__connector-gate-lint-fixture__.ts',
};

function cleanupFixtures(): void {
  for (const f of Object.values(FIXTURES)) removeTree(f);
  removeTree('src/connectors');
}

test('the fixture is what makes the lint fail, not the repo', async () => {
  cleanupFixtures();
  assert.equal(existsSync(REPO + 'src/connectors'), false, 'a previous run left its fixture behind');
  const { code } = await runLint();
  assert.equal(code, 0, 'the repo itself has a connector-gate violation — fix that first');
});

test('kernel importing a connector fails the lint', async () => {
  write(FIXTURES.kernel, "import { readJira } from '../connectors/jira/client.ts';\n");
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /__connector-gate-lint-fixture__\.ts:1/);
    assert.match(stderr, /kernel imports a connector/);
  } finally {
    cleanupFixtures();
  }
});

test('a host importing a connector fails the lint', async () => {
  write(FIXTURES.hosts, "import { readJira } from '../connectors/jira/client.ts';\n");
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /a host imports a connector/);
  } finally {
    cleanupFixtures();
  }
});

test("Construct's own build tooling importing a connector fails the lint, from scripts and from bin", async () => {
  write(FIXTURES.scripts, "import { readJira } from '../src/connectors/jira/client.ts';\n");
  write(FIXTURES.bin, "import { readJira } from '../src/connectors/jira/client.ts';\n");
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /Construct's own build tooling imports a connector/);
    assert.match(stderr, /Construct's own CLI entry point imports a connector/);
  } finally {
    cleanupFixtures();
  }
});

test('a connector importing a host adapter, or another connector, fails the lint — kernel and builtins still pass', async () => {
  write(
    FIXTURES.connector,
    [
      "import { createClaudeAdapter } from '../../hosts/claude/adapter.ts';",
      "import type { ConnectorRead } from '../../kernel/connectors/seam.ts';",
      "import { createHash } from 'node:crypto';",
    ].join('\n') + '\n',
  );
  try {
    const { code, stderr } = await runLint();
    assert.equal(code, 1);
    assert.match(stderr, /a connector imports outside its licensed set.*hosts\/claude\/adapter\.ts/);
    // The kernel import and the node: builtin on the following lines must
    // never be reported — only the host-adapter line is a violation.
    assert.doesNotMatch(stderr, /kernel\/connectors\/seam\.ts/);
    assert.doesNotMatch(stderr, /node:crypto/);
  } finally {
    cleanupFixtures();
  }
});

test('src/cli importing a connector is not checked — the gate is deliberately silent here', async () => {
  write(FIXTURES.cli, "import { readJira } from '../connectors/jira/client.ts';\n");
  try {
    const { code } = await runLint();
    assert.equal(code, 0, 'src/cli/** is the one surface the gate does not govern');
  } finally {
    cleanupFixtures();
  }
});
