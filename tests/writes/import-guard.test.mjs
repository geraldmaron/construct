/**
 * tests/writes/import-guard.test.mjs — guard: no orchestration or
 * embed module may import a provider write adapter directly.
 *
 * Scans lib/orchestration/**, lib/embed/**, and lib/embedded-contract/** for
 * static imports of lib/providers/contract/adapters/*\/governed-write.mjs,
 * index.mjs (the raw CLI-backed github adapter), or any adapters/*\/transport.mjs.
 * lib/writes/** and lib/mcp/tools/provider-write.mjs (the sanctioned I7 MCP
 * face of the same envelope) are the only files permitted that import.
 * A future direct import from a scanned path fails this test, which is the
 * guard the bead requires — not an eslint rule, since this repo has no
 * eslint config wired into the release gate.
 *
 * Consolidated what were two separate, duplicated adapter-
 * factory maps (in control-plane.mjs and provider-write.mjs) into one shared
 * lib/providers/contract/adapter-factories.mjs — the sanctioned direct
 * importer is now that one file, not its two callers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories scanned for a forbidden direct adapter import. */
const SCANNED_DIRS = [
  'lib/orchestration',
  'lib/embed',
  'lib/embedded-contract',
];

/** Sub-paths within a scanned dir that are exempt (declarative, not orchestration code). */
const EXEMPT_PREFIXES = [];

/** Import specifiers that resolve to a governed-write adapter or its raw transport. */
const FORBIDDEN_IMPORT_PATTERN = /providers\/contract\/adapters\/[^'"]*\/(governed-write|transport|index)\.mjs/;

function walk(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      results.push(full);
    }
  }
  return results;
}

function findForbiddenImports() {
  const violations = [];
  for (const scanDir of SCANNED_DIRS) {
    const abs = path.join(REPO_ROOT, scanDir);
    for (const file of walk(abs)) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (EXEMPT_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;

      const source = fs.readFileSync(file, 'utf8');
      const importLines = source
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) || /=\s*require\(/.test(line));

      for (const line of importLines) {
        if (FORBIDDEN_IMPORT_PATTERN.test(line)) {
          violations.push({ file: rel, line: line.trim() });
        }
      }
    }
  }
  return violations;
}

describe('LMCP-J6 import guard — orchestration/embed must not import adapter writes directly', () => {
  it('finds zero direct adapter/governed-write/transport imports under lib/orchestration, lib/embed, lib/embedded-contract', () => {
    const violations = findForbiddenImports();
    assert.deepEqual(
      violations,
      [],
      `direct adapter imports bypass the J2 envelope:\n${violations.map((v) => `  ${v.file}: ${v.line}`).join('\n')}`,
    );
  });

  it('fails when a synthetic orchestration file directly imports a governed-write adapter (guard sanity check)', () => {
    const fixtureDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-guard-fixture-'));
    const fixtureFile = path.join(fixtureDir, 'bad-orchestrator.mjs');
    fs.writeFileSync(
      fixtureFile,
      "import { createGovernedJiraProvider } from '../../lib/providers/contract/adapters/jira/governed-write.mjs';\n",
    );
    try {
      const source = fs.readFileSync(fixtureFile, 'utf8');
      const hasForbidden = source
        .split('\n')
        .some((line) => /^\s*import\b/.test(line) && FORBIDDEN_IMPORT_PATTERN.test(line));
      assert.equal(hasForbidden, true, 'the guard pattern must catch a direct governed-write import');
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('the sanctioned lib/providers/contract/adapter-factories.mjs imports every governed-write adapter it resolves', () => {
    // adapter-factories.mjs lives inside lib/providers/contract/ itself, so its
    // relative imports ('./adapters/...') never contain the literal
    // 'providers/contract/adapters' substring FORBIDDEN_IMPORT_PATTERN scans
    // for from outside callers — check its own relative-import convention instead.
    const abs = path.join(REPO_ROOT, 'lib/providers/contract/adapter-factories.mjs');
    assert.ok(fs.existsSync(abs), 'expected adapter-factories.mjs to exist');
    const source = fs.readFileSync(abs, 'utf8');
    for (const provider of ['jira', 'confluence', 'github', 'slack']) {
      assert.match(
        source,
        new RegExp(`\\./adapters/${provider}/(governed-write|transport|index)\\.mjs`),
        `adapter-factories.mjs is expected to import a ${provider} adapter module directly`,
      );
    }
  });

  it('control-plane.mjs and provider-write.mjs resolve adapters through the shared factory, not a direct import', () => {
    const sanctioned = [
      'lib/writes/control-plane.mjs',
      'lib/mcp/tools/provider-write.mjs',
    ];
    for (const rel of sanctioned) {
      const abs = path.join(REPO_ROOT, rel);
      const source = fs.readFileSync(abs, 'utf8');
      const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line) || /=\s*require\(/.test(line));
      const forbidden = importLines.filter((line) => FORBIDDEN_IMPORT_PATTERN.test(line));
      assert.deepEqual(forbidden, [], `${rel} should resolve adapters via adapter-factories.mjs, not import one directly`);
      assert.match(source, /providers\/contract\/adapter-factories\.mjs/, `${rel} should import from the shared adapter-factories module`);
    }
  });
});
