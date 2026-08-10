/**
 * tests/kernel/run/grounding.test.ts — a role handed documents is told how to
 * use them, and the instrument that scores that skill reads the same words.
 *
 * The last test is the one with teeth. The org-harness scores grounded
 * synthesis, and for a while it scored a protocol that existed only inside the
 * harness script: tuning it would have moved a number without moving anything a
 * user receives. Holding the harness's rendered prompt against the kernel's
 * export is what stops that from coming back quietly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GROUNDED_SYNTHESIS_PROTOCOL,
  groundedMaterialProtocol,
} from '../../../src/kernel/run/grounding.ts';
import { assignmentFor, materialFor } from '../../../src/kernel/run/coordinator.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { addSource, recordSourceRead } from '../../../src/kernel/store/sources.ts';
import { sterile } from '../../harness/sterile.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import type { Material } from '../../../src/kernel/run/grounding.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const BRIEF: Brief = {
  id: 'run-1:engineering',
  outcome: 'Review the organization for cross-cutting risk',
  role: 'engineering',
  inputs: [],
  capabilities: [],
  postconditions: [],
};

const READ: Material = {
  source: 'src-1',
  descriptor: 'tickets in PROJ',
  coverage: 'complete',
  detail: '14 of 14 tickets',
};

test('a dispatch with no material keeps the rule that files nearby are not evidence', () => {
  const assignment = assignmentFor(BRIEF);
  assert.match(assignment, /Never cite a file path as the source for a claim/);
  assert.ok(
    !assignment.includes('Depth over breadth'),
    'the grounded protocol must not reach a role that was handed nothing',
  );
});

test('a dispatch carrying material swaps in the grounded protocol, never both', () => {
  const assignment = assignmentFor(BRIEF, undefined, { material: [READ] });
  assert.ok(assignment.includes(GROUNDED_SYNTHESIS_PROTOCOL));
  assert.ok(
    !assignment.includes('Never cite a file path as the source for a claim'),
    'the two material rules contradict each other and cannot both be spoken',
  );
});

test('an empty material list is the same as none: the role is told the no-material rule', () => {
  const assignment = assignmentFor(BRIEF, undefined, { material: [] });
  assert.match(assignment, /Never cite a file path as the source for a claim/);
});

test('what was read reaches the role in the words the store recorded', () => {
  const assignment = assignmentFor(BRIEF, undefined, { material: [READ] });
  assert.match(assignment, /- tickets in PROJ \(src-1\) \[complete\]: 14 of 14 tickets/);
});

test('a source that could not be read is named as a gap rather than left silent', () => {
  const block = groundedMaterialProtocol([
    READ,
    {
      source: 'src-2',
      descriptor: 'docs/adr/*.md',
      coverage: 'unreachable',
      detail: 'connector returned 401',
    },
  ]);
  assert.match(block, /\[unreachable\]: connector returned 401/);
  assert.match(block, /Not all of it was read/);
  assert.match(block, /never let the gap pass as coverage/);
});

test('complete coverage claims no gap it does not have', () => {
  const block = groundedMaterialProtocol([READ]);
  assert.ok(!block.includes('Not all of it was read'));
});

test('the dispatch path asks the store what the run read rather than a caller', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    assert.deepEqual(materialFor(store, 'run-1'), [], 'a run that read nothing has no material');
    addSource(store, {
      id: 'src-1',
      workspace: 'acme',
      kind: 'jira',
      locator: 'PROJ',
      addedAt: '2026-08-10T00:00:00.000Z',
    });
    recordSourceRead(store, {
      run: 'run-1',
      source: 'src-1',
      descriptor: 'tickets in PROJ',
      coverage: 'partial',
      detail: '9 of 14 tickets',
      recordedAt: '2026-08-10T00:01:00.000Z',
    });
    const material = materialFor(store, 'run-1');
    assert.deepEqual(material, [
      {
        source: 'src-1',
        descriptor: 'tickets in PROJ',
        coverage: 'partial',
        detail: '9 of 14 tickets',
      },
    ]);
    assert.match(assignmentFor(BRIEF, undefined, { material }), /Not all of it was read/);
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('the org-harness scores the protocol the product ships, not a copy of it', () => {
  const rendered = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'org-harness-producer-prompt.mjs'), '--lens', 'engineering'],
    { encoding: 'utf8', cwd: repoRoot },
  );
  assert.ok(
    rendered.includes(GROUNDED_SYNTHESIS_PROTOCOL),
    'the harness prompt must render the kernel export verbatim; a drifted copy ' +
      'scores depth the product never asks for',
  );
});
