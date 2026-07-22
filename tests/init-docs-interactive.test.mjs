/**
 * tests/init-docs-interactive.test.mjs — pins init docs menu options and harness resolution.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DOCS_SETUP_MODE_OPTIONS,
  DOCS_SETUP_MENU_INSTRUCTIONS,
  buildDocsPackOptions,
  buildIndividualLaneOptions,
  resolveDocumentationSelection,
} from '../lib/init/docs-interactive.mjs';
import { DOC_PACKS, DOC_PRESETS } from '../lib/init/doc-lanes.mjs';
import { resetPromptHarnessForTests } from '../lib/prompt-harness.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const EXPECTED_MODE_OPTIONS = [
  { label: 'Packs', value: 'packs' },
  { label: 'Individual docs', value: 'individual' },
  { label: 'Skip (docs folder only)', value: 'skip' },
];

test('docs setup menu options stay stable for harness and TTY tests', () => {
  assert.deepEqual(
    DOCS_SETUP_MODE_OPTIONS.map(({ label, value }) => ({ label, value })),
    EXPECTED_MODE_OPTIONS,
  );
  assert.equal(DOCS_SETUP_MENU_INSTRUCTIONS, '↑↓ Navigate · Enter Select · Q Cancel');
  assert.deepEqual(
    buildDocsPackOptions().map(({ label, value }) => ({ label, value })),
    [
      { label: 'Lean', value: 'lean' },
      { label: 'Product', value: 'product' },
      { label: 'Full', value: 'full' },
    ],
  );
  assert.equal(buildIndividualLaneOptions().length, 11);
});

test('resolveDocumentationSelection honors skip mode via injected prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-interactive-skip-'));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), '# Existing\n');

    const selects = ['skip'];
    const result = await resolveDocumentationSelection({
      target: root,
      skipInteractive: false,
      selectOption: async () => selects.shift(),
      multiSelect: async () => [],
      confirm: async () => true,
    });

    assert.deepEqual(result.lanes, []);
    assert.equal(result.withArchitecture, false);
    assert.equal(result.docsPreset, null);
  } finally {
    rmTmpDir(root);
  }
});

test('resolveDocumentationSelection honors lean pack via injected prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'init-docs-interactive-lean-'));
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), '# Existing\n');

    const selects = ['packs', 'lean'];
    const result = await resolveDocumentationSelection({
      target: root,
      skipInteractive: false,
      selectOption: async () => selects.shift(),
      multiSelect: async () => [],
      confirm: async () => false,
    });

    assert.deepEqual(result.lanes, DOC_PRESETS.lean);
    assert.equal(result.docsPreset, 'lean');
    assert.equal(result.withArchitecture, false);
    assert.equal(result.lanes.length, DOC_PACKS.lean.lanes.length);
  } finally {
    rmTmpDir(root);
  }
});

test('resetPromptHarnessForTests clears cached script state', () => {
  resetPromptHarnessForTests();
  assert.doesNotThrow(() => resetPromptHarnessForTests());
});
