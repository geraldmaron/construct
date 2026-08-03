/**
 * tests/kernel/intake/classify.test.ts — the behavior lock for the classifier
 * harvest.
 *
 * fixtures/classify-golden.json is not hand-written: it is the predecessor's
 * own output, captured by scripts/capture-legacy-classify-golden.mjs against a
 * construct-legacy checkout. So this suite compares the port to what v2 really
 * did, not to what v2's code looked like to a reader. Any diff here is a real
 * behavior change and has to be justified in the commit that causes it.
 *
 * No filesystem, no env: the classifier is pure, so these tests need no sterile
 * fixture at all — which is itself the property being asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyIntake, formatTriageLine, suggestTags } from '../../../src/kernel/intake/classify.ts';
import type { ClassifyInput, TriageResult } from '../../../src/kernel/intake/classify.ts';
import { DEFAULT_TABLE, TABLES } from '../../../src/kernel/intake/table.ts';

interface GoldenCase {
  readonly name: string;
  readonly input: ClassifyInput;
  readonly triage: Record<string, unknown>;
  readonly line: string;
  readonly tags: unknown;
}

const GOLDEN: GoldenCase[] = JSON.parse(
  readFileSync(new URL('./fixtures/classify-golden.json', import.meta.url), 'utf8'),
);

/**
 * v2 named one pipeline stage `artifact`; the glossary retires that word in
 * favor of `deliverable`, and a stage name is Construct's own vocabulary rather
 * than something a user wrote, so the port renames it (construct-egc).
 *
 * The captured corpus is deliberately NOT rewritten to match. It is a record of
 * what the predecessor actually returned, and editing it would break the one
 * property that makes it worth having — that re-running the capture against
 * construct-legacy reproduces it byte for byte. The intentional divergence is
 * declared here instead, so it stays one visible line rather than an invisible
 * edit to the evidence.
 */
function toV3(triage: Record<string, unknown>): Record<string, unknown> {
  return triage.rdStage === 'artifact' ? { ...triage, rdStage: 'deliverable' } : triage;
}

test('golden corpus is non-trivial and covers every preset table', () => {
  assert.ok(GOLDEN.length >= 20, `expected a real corpus, got ${GOLDEN.length} cases`);
  const presets = new Set(GOLDEN.map((c) => c.input.preset ?? 'rnd'));
  for (const id of Object.keys(TABLES)) {
    assert.ok(presets.has(id), `golden corpus never exercises the "${id}" preset`);
  }
});

for (const c of GOLDEN) {
  test(`classify matches v2 — ${c.name}`, () => {
    const actual = classifyIntake(c.input);
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      toV3(c.triage),
      `${c.name}: port diverged from the captured v2 triage`,
    );
  });

  test(`formatTriageLine matches v2 — ${c.name}`, () => {
    const triage = classifyIntake(c.input);
    const expected = c.line.replace(' / artifact ', ' / deliverable ');
    assert.equal(formatTriageLine(c.input.sourcePath ?? '', triage), expected);
  });

  test(`suggestTags matches v2 — ${c.name}`, () => {
    const triage = classifyIntake(c.input);
    assert.deepEqual(
      JSON.parse(JSON.stringify(suggestTags(triage, c.input.related ?? [], null))),
      c.tags,
    );
  });
}

test('classification is deterministic across repeated runs', () => {
  for (const c of GOLDEN) {
    assert.deepEqual(classifyIntake(c.input), classifyIntake(c.input), c.name);
  }
});

test('a caller-supplied table is used directly — no id lookup, no filesystem', () => {
  const table = {
    id: 'custom',
    INTAKE_TYPES: ['widget', 'unknown'],
    STAGES: ['unknown'],
    UNKNOWN_TRIAGE: {
      intakeType: 'unknown',
      rdStage: 'unknown',
      primaryOwner: 'nobody',
      recommendedChain: [],
      recommendedAction: 'summarize',
      risk: 'low',
      requiresApproval: false,
    },
    CLASSIFICATION_TABLE: [
      {
        intakeType: 'widget',
        keywords: ['widget', 'sprocket'],
        rdStage: 'unknown',
        primaryOwner: 'widget-owner',
        recommendedChain: ['widget-owner'],
        recommendedAction: 'implement',
        risk: 'low',
        requiresApproval: false,
      },
    ],
  };
  const hit = classifyIntake({ extractedText: 'the widget and the sprocket', preset: table });
  assert.equal(hit.intakeType, 'widget');
  assert.equal(hit.primaryOwner, 'widget-owner');

  const miss = classifyIntake({ extractedText: 'nothing here', preset: table });
  assert.equal(miss.primaryOwner, 'nobody', 'a custom table brings its own unknown fallback');
});

test('recommendedChain is copied, so a caller cannot mutate the shared table', () => {
  const first = classifyIntake({
    sourcePath: 'inbox/auth-bypass-report.md',
    extractedText: 'Critical CVE: auth bypass via SQLi.',
  });
  (first.recommendedChain as string[]).push('intruder');
  const second = classifyIntake({
    sourcePath: 'inbox/auth-bypass-report.md',
    extractedText: 'Critical CVE: auth bypass via SQLi.',
  });
  assert.ok(!second.recommendedChain.includes('intruder'));
  const entry = DEFAULT_TABLE.CLASSIFICATION_TABLE.find((e) => e.intakeType === 'security');
  assert.ok(!entry!.recommendedChain.includes('intruder'), 'the table itself must be untouched');
});

test('the unknown fallback also copies its chain', () => {
  const first = classifyIntake({ extractedText: 'nothing matches at all' });
  (first.recommendedChain as string[]).push('intruder');
  const second = classifyIntake({ extractedText: 'nothing matches at all' });
  assert.ok(!second.recommendedChain.includes('intruder'));
  assert.ok(!DEFAULT_TABLE.UNKNOWN_TRIAGE.recommendedChain.includes('intruder'));
});

test('suggestTags honors an injected vocabulary threshold and drops retired tags', () => {
  const triage = classifyIntake({
    sourcePath: 'inbox/auth-bypass-report.md',
    extractedText: 'Critical CVE: auth bypass via SQLi.',
  });
  assert.ok(triage.confidence >= 0.7, 'precondition: this case clears the default threshold');

  const raised = suggestTags(triage, [], { facets: { 'intake-type': { auto_threshold: 0.99 } } });
  assert.deepEqual(raised, [], 'a threshold above the confidence suppresses the tag');

  const retired = suggestTags(triage, [], {
    tagMap: new Map([['intake/security', { status: 'deprecated' }]]),
  });
  assert.deepEqual(retired, [], 'a deprecated tag is filtered out');

  const unknownTag = suggestTags(triage, [], { tagMap: new Map() });
  assert.deepEqual(
    unknownTag.map((s) => s.tag),
    ['intake/security'],
    'a tag the vocabulary has never seen is allowed through',
  );
});

test('formatTriageLine falls back for a missing or unknown triage', () => {
  assert.equal(
    formatTriageLine('', null),
    '(unknown source) → unclassified · owner: orchestrator · next: summarize',
  );
  const unknown = classifyIntake({ sourcePath: 'a/b/blank.md', extractedText: 'nothing' });
  assert.equal(
    formatTriageLine('a/b/blank.md', unknown as TriageResult),
    'blank.md → unclassified · owner: orchestrator · next: summarize',
  );
});
