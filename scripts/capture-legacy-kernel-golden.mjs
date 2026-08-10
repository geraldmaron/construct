/**
 * scripts/capture-legacy-kernel-golden.mjs — one-shot capture of the
 * predecessor's completion-ladder behavior, frozen into
 * tests/kernel/fixtures/completion-golden.json.
 *
 * Both v2 modules are pure with no IO, so the dual run is direct: feed the same
 * corpus to v2 and record what it returned (or which error it threw). The port
 * is then asserted against that, not against a reading of v2's source.
 *
 * Needs a construct-legacy checkout; NOT part of the test run. The frozen JSON
 * is. A diff on re-run is a real behavior change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY =
  process.env.CONSTRUCT_LEGACY ?? join(process.env.HOME ?? '', 'Developer/Projects/construct-legacy');

const { makeEvidence, recordCompletion, highestState, DEGRADATION_REASONS } = await import(
  `${LEGACY}/lib/artifact-completion.mjs`
);
const { COMPLETION_STATES, isCompletionState, completionRank } = await import(
  `${LEGACY}/lib/artifact-completion-states.mjs`
);

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../tests/kernel/fixtures/${name}`, import.meta.url), 'utf8'));
const write = (name, value) => {
  const url = new URL(`../tests/kernel/fixtures/${name}`, import.meta.url);
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`captured ${Array.isArray(value) ? value.length : Object.keys(value).length} -> ${name}`);
};

// v3 renamed a field to match the glossary (deliverable). The corpus is written
// in v3 names; this translates a case back into v2's spelling so the dual run
// compares behavior rather than vocabulary.

const toV2Evidence = (input) => {
  const { deliverable, ...rest } = input ?? {};
  return deliverable === undefined ? input : { ...rest, artifact: deliverable };
};

// --- completion ladder ------------------------------------------------------

const evidenceCases = read('completion-cases.json');

const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

write('completion-golden.json', {
  states: COMPLETION_STATES,
  degradationReasons: DEGRADATION_REASONS,
  ranks: Object.fromEntries(
    [...COMPLETION_STATES, 'not-a-state'].map((s) => [s, completionRank(s)]),
  ),
  isState: Object.fromEntries(
    [...COMPLETION_STATES, 'not-a-state', ''].map((s) => [s, isCompletionState(s)]),
  ),
  evidence: evidenceCases.evidence.map((c) => ({
    name: c.name,
    state: c.state,
    input: c.input,
    outcome: attempt(() => makeEvidence(c.state, toV2Evidence(c.input))),
  })),
  ledgers: evidenceCases.ledgers.map((c) => {
    const outcome = attempt(() => {
      let ledger = [];
      for (const e of c.entries) ledger = recordCompletion(ledger, makeEvidence(e.state, toV2Evidence(e.input)));
      return { ledger, highest: highestState(ledger) };
    });
    return { name: c.name, entries: c.entries, outcome };
  }),
  // recordCompletion's own guard, exercised with values makeEvidence would never produce.
  rejects: [null, undefined, 'authored', {}, { state: 'not-a-state' }].map((bad) => ({
    input: bad === undefined ? '<undefined>' : bad,
    outcome: attempt(() => recordCompletion([], bad)),
  })),
});
