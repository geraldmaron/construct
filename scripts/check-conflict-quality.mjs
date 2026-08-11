#!/usr/bin/env node
/**
 * check-conflict-quality.mjs — measure what a run did with a genuine
 * cross-concern disagreement, against the store the run actually wrote.
 *
 * Commitment 11's machinery has been measured before, on the concerns that
 * existed when it was written. This reads a run implicating two of the newer
 * ones and asks the three questions that decide whether the machinery worked
 * rather than merely ran:
 *
 *   1. BOTH SIDES SURFACED, EACH ON ITS OWN EVIDENCE. A conflict where one role
 *      declared a position and the other stayed silent is not a conflict the
 *      system resolved; it is one role talking. Each side must have declared a
 *      stance and cited something, and the two citations must not be the same
 *      thing — two roles reading one document back at each other is agreement
 *      wearing a disagreement's clothes.
 *   2. THE DECISION CARRIES BOTH POSITIONS AND A REVERSIBLE DEFAULT. The
 *      amended shape: what fired, both cited positions, and the branch that
 *      holds if the user does nothing. A framing that names the sides and stops
 *      hands the user back the work they were delegating.
 *   3. NEITHER SIDE WINS BY DEFAULT. No recommendation, no ordering that reads
 *      as precedence, and the reversible default named as what silence costs
 *      rather than as a preference — with the roles that argued for it named,
 *      so it has an author and is not the tool's own view.
 *
 * Structural throughout, and the bound is the usual one: this reads whether the
 * disagreement was surfaced in the shape the commitment requires, never whether
 * either side was right. Whether the architecture's reversibility argument
 * actually beats the strategy's speed argument is a judgment no checker makes.
 *
 * Usage:
 *   node scripts/check-conflict-quality.mjs --run <run-id> [--store <path>] [--json]
 *   node scripts/check-conflict-quality.mjs --fixture <recorded.json> [--json]
 *
 * The fixture form scores a recorded run so the check itself is testable
 * without a live model; the shapes are identical.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { openStore, storePath } from '../src/kernel/store/open.ts';
import { resolvePaths } from '../src/kernel/paths.ts';
import { listTasks } from '../src/kernel/store/tasks.ts';
import { openDecisions, resolvedDecisions } from '../src/kernel/store/decisions.ts';
import { parseStance } from '../src/kernel/run/conflicts.ts';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const runId = arg('--run');
const fixture = arg('--fixture');
if (!runId && !fixture) {
  console.error('usage: check-conflict-quality.mjs --run <run-id> | --fixture <recorded.json> [--json]');
  process.exit(2);
}

/** { deliverables: [{role, text}], decision: {question, positions} | null } */
let observed;
if (fixture) {
  observed = JSON.parse(readFileSync(fixture, 'utf8'));
} else {
  const store = openStore(arg('--store') ?? storePath(resolvePaths()));
  try {
    const deliverables = listTasks(store, runId)
      .filter((t) => t.state === 'done')
      .map((t) => ({
        role: t.role,
        text:
          typeof t.result?.text === 'string'
            ? t.result.text
            : typeof t.result === 'string'
              ? t.result
              : '',
      }));
    const decisions = [...openDecisions(store), ...resolvedDecisions(store, runId)].filter(
      (d) => d.run === runId && d.id.endsWith(':stance'),
    );
    observed = { deliverables, decision: decisions[0] ?? null };
  } finally {
    store.close();
  }
}

const stances = observed.deliverables
  .map((d) => ({ role: d.role, declared: parseStance(d.text) }))
  .filter((s) => s.declared !== null);
const sides = stances.filter((s) => s.declared.stance !== 'unclear');
const holds = sides.filter((s) => s.declared.stance === 'hold');
const proceeds = sides.filter((s) => s.declared.stance === 'proceed');

const cited = sides.filter((s) => s.declared.citation !== null);
const distinctCitations = new Set(cited.map((s) => s.declared.citation.toLowerCase().trim()));

const decision = observed.decision;
const positions = decision?.positions ?? [];
const rolePositions = positions.filter((p) => p.role !== 'construct');
const fallback = positions.find(
  (p) => p.role === 'construct' && /reversible default if you do nothing/i.test(p.stance ?? ''),
);

const checks = [
  {
    id: 'both-sides-declared',
    pass: holds.length > 0 && proceeds.length > 0,
    detail:
      holds.length > 0 && proceeds.length > 0
        ? `${holds.map((s) => s.role).join(', ')} held; ${proceeds.map((s) => s.role).join(', ')} proceeded`
        : `only one side declared: ${sides.map((s) => `${s.role}=${s.declared.stance}`).join(', ') || 'none'}`,
  },
  {
    id: 'each-cites-its-own',
    pass: cited.length === sides.length && distinctCitations.size === sides.length,
    detail:
      cited.length < sides.length
        ? `${sides.length - cited.length} side(s) took a position and cited nothing`
        : distinctCitations.size < sides.length
          ? 'two sides cited the same evidence — that is one reading, not two'
          : `${distinctCitations.size} distinct citations, one per side`,
  },
  {
    id: 'decision-carries-both',
    pass: rolePositions.length >= 2 && rolePositions.every((p) => p.stance),
    detail:
      rolePositions.length >= 2
        ? `${rolePositions.length} positions in the inbox decision`
        : `the decision carries ${rolePositions.length} position(s); a one-sided question is a report`,
  },
  {
    id: 'reversible-default',
    pass: Boolean(fallback),
    detail: fallback
      ? 'the decision states what silence costs'
      : 'no reversible default: the framing names the sides and stops',
  },
  {
    id: 'no-default-winner',
    pass:
      !/recommend|suggest|should probably|we advise/i.test(JSON.stringify(decision ?? {})) &&
      (!fallback || /not a preference|the call is yours/i.test(fallback.stance)),
    detail:
      'no recommendation, and the default is stated as the cost of silence rather than as a choice made for the user',
  },
];

const pass = checks.every((c) => c.pass);
const result = {
  run: runId ?? fixture,
  pass,
  stances: sides.map((s) => ({
    role: s.role,
    stance: s.declared.stance,
    because: s.declared.because,
    citation: s.declared.citation,
  })),
  checks,
  bound:
    'structural: whether the disagreement was surfaced in the shape commitment 11 requires. Whether either side is right is a substantive question this check cannot answer.',
};

if (jsonMode) {
  console.log(JSON.stringify(result, null, 1));
} else {
  console.log(`conflict quality — ${result.run}`);
  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${c.detail}`);
  console.log(`  ${result.bound}`);
}

process.exit(pass ? 0 : 1);
