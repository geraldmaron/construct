/**
 * tests/init-docs-default.test.mjs — docs selection for construct init.
 *
 * Pins the product rule that non-interactive init does not auto-pick doc
 * lanes; curated packs and individual flags remain explicit opt-ins.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { rmTmpDir } from './helpers/cleanup.mjs';
import {
  resolveNonInteractiveDocsLanes,
  DOC_PRESETS,
  DOC_PACKS,
} from '../lib/init/doc-lanes.mjs';
import {
  ensureInitTarget,
  assertNotNestedInit,
} from '../lib/init-unified.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

test('resolveNonInteractiveDocsLanes defaults to no lanes', () => {
  assert.deepEqual(resolveNonInteractiveDocsLanes({}), []);
});

test('resolveNonInteractiveDocsLanes applies docs pack only when named', () => {
  assert.deepEqual(
    resolveNonInteractiveDocsLanes({ docsPresetName: 'lean' }),
    DOC_PRESETS.lean,
  );
  assert.deepEqual(resolveNonInteractiveDocsLanes({ docsPresetName: 'full' }), DOC_PRESETS.full);
  assert.equal(DOC_PACKS.lean.lanes.length, DOC_PRESETS.lean.length);
});

test('resolveNonInteractiveDocsLanes rejects unknown packs', () => {
  assert.throws(
    () => resolveNonInteractiveDocsLanes({ docsPresetName: 'enterprise-docs' }),
    /Unknown docs pack/,
  );
});

test('resolveNonInteractiveDocsLanes honors individual and with-all flags', () => {
  assert.deepEqual(
    resolveNonInteractiveDocsLanes({ withAdrs: true, withRfcs: true }),
    ['adrs', 'rfcs'],
  );
  assert.ok(resolveNonInteractiveDocsLanes({ withAllDocs: true }).includes('runbooks'));
});

test('ensureInitTarget rejects missing paths with actionable guidance', () => {
  assert.throws(
    () => ensureInitTarget(join(tmpdir(), 'construct-missing-init-target-xyz')),
    /Target directory does not exist/,
  );
});

test('assertNotNestedInit blocks scaffolding under an existing Construct root', () => {
  const root = mkdtempSync(join(tmpdir(), 'init-nested-'));
  try {
    mkdirSync(join(root, '.construct'), { recursive: true });
    const sub = join(root, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    assert.throws(() => assertNotNestedInit(sub), /already initialized/);
    assert.doesNotThrow(() => assertNotNestedInit(sub, { force: true }));
    assert.doesNotThrow(() => assertNotNestedInit(root));
  } finally {
    rmTmpDir(root);
  }
});

test('construct init --yes scaffolds docs/ only (no lane dirs)', () => {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-default-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'package.json'), '{"name":"docs-default-check"}\n');

  try {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--yes', '--no-start', '--no-beads'],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          HOME,
          CONSTRUCT_HOME_OVERRIDE: HOME,
          CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
          BOOTSTRAP_CHECKED: '1',
          NODE_ENV: 'test',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(project, 'docs', 'README.md')));
    assert.equal(existsSync(join(project, 'docs', 'adr')), false);
    assert.equal(existsSync(join(project, 'docs', 'prds')), false);
    assert.equal(existsSync(join(project, 'docs', 'meetings')), false);
    assert.match(result.stdout, /docs\/ only/i);
  } finally {
    rmTmpDir(root);
  }
});

test('construct init --yes --docs-preset=lean scaffolds the lean pack', () => {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-lean-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });

  try {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--yes', '--no-start', '--no-beads', '--docs-preset=lean'],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          HOME,
          CONSTRUCT_HOME_OVERRIDE: HOME,
          CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
          BOOTSTRAP_CHECKED: '1',
          NODE_ENV: 'test',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(join(project, 'docs', 'adr')));
    assert.ok(existsSync(join(project, 'docs', 'prds')));
    assert.equal(existsSync(join(project, 'docs', 'rfcs')), false);
    const readme = readFileSync(join(project, 'README.md'), 'utf8');
    assert.match(readme, /## Usage/);
    const verify = spawnSync(
      process.execPath,
      [BIN, 'docs:verify'],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          HOME,
          CONSTRUCT_HOME_OVERRIDE: HOME,
          NODE_ENV: 'test',
        },
      },
    );
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  } finally {
    rmTmpDir(root);
  }
});

test('construct init rejects unknown flags', () => {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-flag-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });

  try {
    const result = spawnSync(
      process.execPath,
      [BIN, 'init', '--yes', '--no-start', '--no-beads', '--typo-flag'],
      {
        cwd: project,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          HOME,
          CONSTRUCT_HOME_OVERRIDE: HOME,
          CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
          BOOTSTRAP_CHECKED: '1',
          NODE_ENV: 'test',
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /Unknown flag/);
  } finally {
    rmTmpDir(root);
  }
});
