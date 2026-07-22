/**
 * tests/lean-ceremony-teaching.test.mjs — fail-closed gate for lean day-1 teaching.
 *
 * Progressive disclosure: beads / intake / graph stay available as opt-in
 * power surfaces. Lean first-run teaching (construct_guide, start docs,
 * session-prelude copy, AGENTS inject) must not force graph intent declare
 * or intake triage before a normal coding task. Hard gates remain taught.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildConstructIntegrationBody } from '../lib/agent-instructions/inject.mjs';
import { buildIntakePrelude } from '../lib/intake/session-prelude.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

function dayOneCommandsTable(guide) {
  const dayOne = guide.indexOf('### Day-one commands');
  const whenNeed = guide.indexOf('## When you need them');
  assert.ok(dayOne >= 0, 'construct_guide must have Day-one commands');
  assert.ok(whenNeed > dayOne, 'When you need them must follow Day-one commands');
  return guide.slice(dayOne, whenNeed);
}

test('construct_guide day-one table omits intake/graph ceremony verbs', () => {
  const guide = read('templates/docs/construct_guide.md');
  const dayTable = dayOneCommandsTable(guide);
  assert.doesNotMatch(dayTable, /construct intake/);
  assert.doesNotMatch(dayTable, /graph from-intake/);
  assert.doesNotMatch(dayTable, /graph intent declare/);
  assert.match(dayTable, /construct doctor/);
  assert.match(guide, /## When you need them \(opt-in power surfaces\)/);
  assert.match(guide, /nngroup\.com\/articles\/progressive-disclosure/);
  assert.match(guide, /Hard gates/);
  assert.doesNotMatch(guide, /Process via the recommended chain/);
});

test('start docs do not require intake triage or graph intent before first coding task', () => {
  const firstTask = read('docs/guides/start/first-task.mdx');
  const index = read('docs/guides/start/index.mdx');
  const whatNext = read('docs/guides/start/what-next.md');

  const beforeDispatch = firstTask.slice(
    0,
    firstTask.indexOf('## Dispatch a task'),
  );
  assert.doesNotMatch(beforeDispatch, /graph intent declare/);
  assert.doesNotMatch(beforeDispatch, /construct intake (list|show|done)/);
  assert.match(beforeDispatch, /you do \*\*not\*\* need to file beads/i);
  assert.match(firstTask, /## When you need more \(opt-in\)/);
  const optIn = firstTask.slice(firstTask.indexOf('## When you need more'));
  assert.match(optIn, /construct graph intent declare/);
  assert.match(optIn, /construct intake/);

  assert.doesNotMatch(index, /intake · concepts · cookbook/);
  assert.match(index, /lean path · power when needed/);
  assert.match(index, /not required to write code on day one/i);

  assert.match(whatNext, /## Lean essentials/);
  assert.match(whatNext, /## Power surfaces \(when you need them\)/);
  assert.match(whatNext, /progressive disclosure/i);
});

test('AGENTS inject teaches opt-in tracker/signals, not mandatory ceremony', () => {
  const body = buildConstructIntegrationBody({ hasBeadsBlock: false });
  assert.doesNotMatch(body, /use Beads \(`bd`\) for all task tracking/i);
  assert.doesNotMatch(body, /\*\*Signals\*\*: drop a file into `inbox\/`; `construct intake` classifies/);
  assert.match(body, /File signals \(opt-in\)/);
  assert.match(body, /Hard gates/);
  assert.match(body, /not required to write code/);
});

test('session-prelude pending copy stays opt-in (empty queue stays silent)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-lean-prelude-'));
  try {
    assert.equal(buildIntakePrelude({ cwd: empty }), '');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }

  const src = read('lib/intake/session-prelude.mjs');
  assert.match(src, /Optional — not a coding blocker/);
  assert.doesNotMatch(src, /Process via the recommended chain/);
});
