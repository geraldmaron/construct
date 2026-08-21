/**
 * tests/hosts/repo/gates.test.ts — reading a real consumer repository's own
 * files off disk, against real fixtures in a tmpdir.
 *
 * kernel/run/repoaudit.test.ts covers the judgment against hand-built facts;
 * this covers the IO that gathers those facts for real — package.json
 * parsing, the .github/workflows listing, eslint config detection, and the
 * TypeScript signal — plus the honest failure path for a root that cannot be
 * read at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherRepoFacts } from '../../../src/hosts/repo/gates.ts';
import { auditProposals, evaluateGates } from '../../../src/kernel/run/repoaudit.ts';

function tmpRepo(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-audit-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test('a directory with no package.json reads as one, honestly, not as unreachable', () => {
  const { root, cleanup } = tmpRepo();
  try {
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    assert.equal(facts.packageJson, null);
    assert.deepEqual(facts.ciWorkflowFiles, []);
    assert.equal(facts.eslintConfigPath, null);
    assert.equal(facts.isTypeScriptProject, false);
  } finally {
    cleanup();
  }
});

test('package.json scripts are read exactly as written', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeJson(join(root, 'package.json'), {
      name: 'fixture',
      scripts: { build: 'tsc', test: 'node --test' },
      devDependencies: { typescript: '^5.9.0' },
    });
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    assert.equal(facts.packageJson?.path, join(root, 'package.json'));
    assert.deepEqual(facts.packageJson?.scripts, { build: 'tsc', test: 'node --test' });
    assert.equal(facts.isTypeScriptProject, true, 'a typescript devDependency is a TypeScript signal');
  } finally {
    cleanup();
  }
});

test('a tsconfig.json alone is a TypeScript signal, with no dependency needed', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeJson(join(root, 'package.json'), { name: 'fixture', scripts: {} });
    writeJson(join(root, 'tsconfig.json'), { compilerOptions: { strict: true } });
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    assert.equal(facts.isTypeScriptProject, true);
  } finally {
    cleanup();
  }
});

test('a malformed package.json is read as carrying no scripts, not thrown', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeFileSync(join(root, 'package.json'), '{ this is not valid json');
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    // A file that exists but does not parse still counts as "package.json
    // exists" (the path is real) with no scripts readable from it — the
    // audit that is checking a repository must not crash on the repository's
    // own malformed file.
    assert.equal(facts.packageJson?.path, join(root, 'package.json'));
    assert.deepEqual(facts.packageJson?.scripts, {});
  } finally {
    cleanup();
  }
});

test('CI workflow files are listed from .github/workflows, sorted, non-yaml ignored', () => {
  const { root, cleanup } = tmpRepo();
  try {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'release.yml'), 'name: release\n');
    writeFileSync(join(root, '.github', 'workflows', 'ci.yaml'), 'name: ci\n');
    writeFileSync(join(root, '.github', 'workflows', 'README.md'), 'not a workflow\n');
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    assert.deepEqual(facts.ciWorkflowFiles, ['.github/workflows/ci.yaml', '.github/workflows/release.yml']);
  } finally {
    cleanup();
  }
});

test('an eslint config is found by name, and its path is reported', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeFileSync(join(root, '.eslintrc.json'), '{}');
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    assert.equal(facts.eslintConfigPath, '.eslintrc.json');
  } finally {
    cleanup();
  }
});

test('a root that does not exist reads as unreachable, with a reason, never a crash', () => {
  const { root, cleanup } = tmpRepo();
  try {
    const facts = gatherRepoFacts(join(root, 'does-not-exist'));
    assert.equal(facts.outcome, 'unreachable');
    if (facts.outcome !== 'unreachable') return;
    assert.ok(facts.reason.length > 0);
  } finally {
    cleanup();
  }
});

test('a root that is a file, not a directory, reads as unreachable', () => {
  const { root, cleanup } = tmpRepo();
  try {
    const filePath = join(root, 'not-a-directory');
    writeFileSync(filePath, 'x');
    const facts = gatherRepoFacts(filePath);
    assert.equal(facts.outcome, 'unreachable');
  } finally {
    cleanup();
  }
});

test('end to end: a real fixture repo missing every gate reads, evaluates, and proposes consistently', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeJson(join(root, 'package.json'), {
      name: 'consumer-fixture',
      scripts: { build: 'tsc', test: 'node --test' },
      devDependencies: { typescript: '^5.9.0' },
    });
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    const findings = evaluateGates(facts);
    const missing = findings.filter((f) => f.status === 'missing').map((f) => f.gate);
    assert.deepEqual(missing.sort(), ['a11y-tests', 'ci', 'lint-strictness', 'security-tests', 'typecheck']);
    const proposals = auditProposals({ findings, source: 'consumer-repo', locator: root });
    assert.equal(proposals.length, 5);
    for (const proposal of proposals) {
      // Every citation is a path actually under this fixture's root — real,
      // not invented.
      assert.ok(proposal.justification.startsWith(root), `${proposal.justification} does not cite ${root}`);
    }
  } finally {
    cleanup();
  }
});

test('end to end: a real fixture repo carrying every gate proposes nothing', () => {
  const { root, cleanup } = tmpRepo();
  try {
    writeJson(join(root, 'package.json'), {
      name: 'consumer-fixture',
      scripts: {
        'test:a11y': 'jest --config a11y.jest.config.js',
        'test:security': 'audit-ci --moderate',
        lint: 'eslint . --max-warnings=0',
        typecheck: 'tsc --noEmit',
      },
      devDependencies: { typescript: '^5.9.0' },
    });
    writeFileSync(join(root, '.eslintrc.json'), '{}');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    const facts = gatherRepoFacts(root);
    assert.equal(facts.outcome, 'read');
    if (facts.outcome !== 'read') return;
    const findings = evaluateGates(facts);
    assert.ok(findings.every((f) => f.status === 'enabled'));
    const proposals = auditProposals({ findings, source: 'consumer-repo', locator: root });
    assert.deepEqual(proposals, []);
  } finally {
    cleanup();
  }
});
