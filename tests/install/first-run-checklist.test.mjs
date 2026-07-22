/**
 * tests/install/first-run-checklist.test.mjs — install/postinstall next-steps checklist.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  FIRST_TASK_GUIDE_DOC,
  INSTALL_GUIDE_DOC,
  formatFirstRunChecklist,
} from '../../lib/install/first-run-checklist.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('checklist references canonical docs paths that exist in the repo', () => {
  for (const docPath of [INSTALL_GUIDE_DOC, FIRST_TASK_GUIDE_DOC]) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, docPath)),
      `expected ${docPath} to exist for docs:verify`,
    );
  }
});

test('install-complete checklist includes init, doctor, and sync', () => {
  const text = formatFirstRunChecklist({ context: 'install-complete' });
  assert.match(text, /Next steps:/);
  assert.match(text, /construct init/);
  assert.match(text, /construct doctor/);
  assert.match(text, /construct sync/);
  assert.match(text, new RegExp(INSTALL_GUIDE_DOC.replace('.', '\\.')));
  assert.match(text, new RegExp(FIRST_TASK_GUIDE_DOC.replace('.', '\\.')));
});

test('install-dry-run checklist includes numbered steps', () => {
  const text = formatFirstRunChecklist({ context: 'install-dry-run' });
  assert.match(text, /^\s*1\. /m);
  assert.match(text, /^\s*2\. /m);
  assert.match(text, /^\s*3\. /m);
});
