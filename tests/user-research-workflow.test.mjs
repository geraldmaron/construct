/**
 * tests/user-research-workflow.test.mjs — user-research workflow validity and inter-rater coverage.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(REPO, 'skills', 'docs', 'user-research-workflow.md');

test('user-research-workflow documents validity threats and inter-rater reliability', () => {
  const body = readFileSync(WORKFLOW, 'utf8');
  assert.match(body, /internal\/external\/construct\/conclusion/);
  assert.match(body, /Inter-rater reliability/i);
  assert.match(body, /perspectives\/researcher/);
  assert.match(body, /researcher/);
});

test('user-research-workflow routes external and codebase research elsewhere', () => {
  const body = readFileSync(WORKFLOW, 'utf8');
  assert.match(body, /docs\/research-workflow/);
  assert.match(body, /docs\/codebase-research-workflow/);
  assert.match(body, /researcher/);
  // construct-rf26.11 folded cx-explorer into researcher (a skill overlay,
  // not a separate specialist), so both sibling workflows now name the same agent.
  assert.match(body, /skill overlay/);
});
