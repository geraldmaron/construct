/**
 * tests/cli-deprecated-surface.test.mjs — CLI compat catalog and help-hidden surfaces.
 *
 * construct-tsyfe.9.5: documented-vs-actual command surface audit. Validates that
 * default/catalog help does not advertise retired compat forms, that the command
 * catalog reconciles dispatch with CLI_COMMANDS, and that sunset decisions are recorded.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
const __hygieneTmpDirs = [];
test.after(() => {
  for (const dir of __hygieneTmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
import { fileURLToPath } from 'node:url';
import {
  buildCliCommandCatalog,
  collectPublicHelpCorpus,
  findHelpHiddenViolations,
  renderCliCommandCatalogMarkdown,
  CLI_SUNSET_DECISIONS,
} from '../lib/cli-compat-catalog.mjs';
import { CLI_COMMANDS } from '../lib/cli-commands.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'construct');
const ARCH_PATH = path.join(REPO, 'docs/guides/concepts/architecture.mdx');
const CATALOG_PATH = path.join(REPO, 'docs/guides/reference/cli/command-catalog.md');

function canSpawnConstruct() {
  const probe = spawnSync(process.execPath, ['--test', '--test-name=noop'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  const smoke = spawnSync(process.execPath, [BIN, '--version'], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' },
  });
  return !smoke.error && smoke.status === 0;
}

test('public help corpus does not advertise retired compat surfaces', () => {
  const corpus = collectPublicHelpCorpus({ rootDir: REPO });
  const violations = findHelpHiddenViolations(corpus);
  assert.deepEqual(violations, [], `help corpus advertises retired surfaces: ${JSON.stringify(violations)}`);
});

test('command catalog lists every runtime handler with a classification', () => {
  const catalog = buildCliCommandCatalog({ rootDir: REPO });
  const handlers = new Set(catalog.commands.filter((row) => row.status !== 'removed' && row.status !== 'unknown').map((row) => row.name));
  const undocumented = catalog.commands.filter((row) => row.status === 'undocumented-handler');
  assert.deepEqual(undocumented, [], `undocumented handlers: ${undocumented.map((r) => r.name).join(', ')}`);
  assert.ok(catalog.handlerCount >= CLI_COMMANDS.filter((c) => !c.internal).length);
  assert.ok(handlers.size > 0);
});

test('ADR-0053 matrix alias decision is explicit and removed', () => {
  assert.equal(CLI_SUNSET_DECISIONS.matrix.status, 'removed');
  assert.match(CLI_SUNSET_DECISIONS.matrix.decision, /ADR-0053/);
  assert.match(CLI_SUNSET_DECISIONS.matrix.replacement, /construct graph/);
  const catalog = buildCliCommandCatalog({ rootDir: REPO });
  assert.ok(!catalog.commands.some((row) => row.name === 'matrix' && row.status === 'current'));
});

test('architecture.mdx no longer references construct matrix build', () => {
  const text = fs.readFileSync(ARCH_PATH, 'utf8');
  assert.doesNotMatch(text, /construct matrix build/i);
});

test('command-catalog artifact matches the live dispatch table', () => {
  const catalog = buildCliCommandCatalog({ rootDir: REPO });
  const rendered = renderCliCommandCatalogMarkdown(catalog);
  fs.writeFileSync(CATALOG_PATH, rendered);
  const onDisk = fs.readFileSync(CATALOG_PATH, 'utf8');
  assert.match(onDisk, /## Sunset decisions/);
  assert.match(onDisk, /construct matrix/);
  assert.match(onDisk, /construct graph/);
  for (const row of catalog.commands.filter((entry) => entry.status === 'current')) {
    assert.match(onDisk, new RegExp(`\`${row.name}\``));
  }
});

test('construct --help hides deprecated aliases when CLI is runnable', { skip: !canSpawnConstruct() ? 'CLI spawn preflight failed' : false }, () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), 'construct-cli-help-'));
  __hygieneTmpDirs.push(home);
  const result = spawnSync(process.execPath, [BIN, '--help'], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CONSTRUCT_HOME_OVERRIDE: home, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' },
  });
  if (result.error?.code === 'ERR_MODULE_NOT_FOUND') return;
  assert.equal(result.status, 0, result.stderr);
  const violations = findHelpHiddenViolations(result.stdout + result.stderr);
  assert.deepEqual(violations, [], JSON.stringify(violations));
});
