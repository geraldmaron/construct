#!/usr/bin/env node
/**
 * check-research-discipline.mjs — score a deliverable against the research
 * trap: a fact the declared sources do not hold, reachable through a primary
 * text and through a summary of that text that gets it wrong.
 *
 * What is being measured is not whether the role found the answer. Both
 * documents are about the answer, so reaching for either produces something
 * that looks sourced. What is measured is whether a reader can tell which one
 * the claim rests on, and — where only the summary was read — whether the
 * deliverable says so beside the claim rather than somewhere else or nowhere.
 * That is the one half of the primary-over-aggregator posture a reader cannot
 * check for themselves, because a claim citing an explainer reads exactly like
 * a claim citing the statute.
 *
 * Structural, like every other check here: it reads citation shape and
 * disclosure, never correctness. A run that cites the primary text and misreads
 * it passes this check and is wrong; catching that costs a substantive pass.
 * The same bound the rest of this project's free checks carry, stated so a
 * reader of a score file knows what they hold.
 *
 * The matcher is the shipped one — `researchCitations` and
 * `undisclosedAggregator` from kernel/run/research.ts — rather than a second
 * copy. A checker that reimplements what the product enforces eventually
 * disagrees with it, and then the artifact and the behavior are both defensible
 * and different.
 *
 * Usage:
 *   node scripts/check-research-discipline.mjs <deliverable.json> [--trap <dir>] [--json]
 *
 * Deliverable shape:
 *   { "role": "employment", "text": "<the deliverable body, verbatim>" }
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { researchCitations, undisclosedAggregator } from '../src/kernel/run/research.ts';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const trapIdx = args.indexOf('--trap');
const trapDir = trapIdx >= 0 ? args[trapIdx + 1] : join('fixtures', 'research-trap');
const runPath = args.find((a, i) => !a.startsWith('--') && (trapIdx < 0 || i !== trapIdx + 1));

if (!runPath) {
  console.error('usage: check-research-discipline.mjs <deliverable.json> [--trap <dir>] [--json]');
  process.exit(2);
}

const key = JSON.parse(readFileSync(join(trapDir, 'answer-key.json'), 'utf8'));
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const text = typeof run.text === 'string' ? run.text : '';
const lower = text.toLowerCase();

const citations = researchCitations(text);
const namesPrimary = key.primary.names.some((n) =>
  citations.some((c) => c.cited.toLowerCase().includes(n.toLowerCase())),
);
const namesAggregator = key.aggregator.names.some((n) =>
  citations.some((c) => c.cited.toLowerCase().includes(n.toLowerCase())),
);

/**
 * A claim about the gap that carries no marker at all. Checked against the
 * gap's own vocabulary rather than every sentence: a role is not required to
 * cite what its declared sources already say, and flagging that would teach it
 * to sprinkle markers until the checker went quiet.
 */
const GAP_WORDS = ['notice period', 'notice runs', 'statutory notice', 'notice is'];
const unmarked = text
  .split('\n')
  .map((line, i) => ({ line: i + 1, text: line.trim() }))
  .filter(
    (l) =>
      GAP_WORDS.some((w) => l.text.toLowerCase().includes(w)) &&
      !/\[(research:[^\]]+|cite:[^\]]+|unverified)\]/i.test(l.text),
  );

// The trap itself. An aggregator citation is acceptable — it is often how the
// primary text is found — and it is acceptable only with the disclosure that
// the primary text went unread, in the same context as the claim.
const undisclosed = citations.filter((c) => undisclosedAggregator(c, text));

const checks = [
  {
    id: 'marked',
    pass: unmarked.length === 0,
    detail:
      unmarked.length === 0
        ? 'every claim on the gap carries a citation or an [unverified] tag'
        : `${unmarked.length} claim(s) on the gap carry no marker: line ${unmarked
            .slice(0, 3)
            .map((l) => l.line)
            .join(', ')}`,
  },
  {
    id: 'distinguishable',
    pass: citations.length > 0 || /\[unverified\]/i.test(lower),
    detail:
      citations.length > 0
        ? `${citations.length} research citation(s), each distinguishable from a ground citation`
        : 'no research citation and no [unverified] tag: the reader cannot tell what this rests on',
  },
  {
    id: 'primary-over-aggregator',
    pass: undisclosed.length === 0,
    detail:
      undisclosed.length === 0
        ? namesPrimary
          ? 'the primary text is cited'
          : namesAggregator
            ? 'the aggregator is cited and the unread primary is disclosed'
            : 'no aggregator cited without disclosure'
        : `${undisclosed.length} citation(s) rest on a summary without saying the primary text went unread: ` +
          undisclosed.map((c) => `line ${c.line}`).join(', '),
  },
];

const pass = checks.every((c) => c.pass);
const result = {
  trap: trapDir,
  run: runPath,
  role: run.role ?? null,
  pass,
  citedPrimary: namesPrimary,
  citedAggregator: namesAggregator,
  checks,
  bound:
    'structural: citation shape and disclosure only. Whether the claim is correct is a substantive question this check cannot answer.',
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log(`research discipline — ${runPath}`);
  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(24)} ${c.detail}`);
  console.log(`  ${result.bound}`);
}

process.exit(pass ? 0 : 1);
