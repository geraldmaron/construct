#!/usr/bin/env node
/**
 * generate-org-map.mjs — write docs/org-map.md from the catalog itself.
 *
 * The thesis this project is built on — the tacit contracts a cross-functional
 * organization runs on, made explicit and routed without anyone asking — is
 * spread across STRATEGY and the tracker, and a reader lands on neither. It
 * needs a page. What a page must not become is a second copy of the catalog
 * that drifts from it: this repository's own history is a list of documents
 * that were true when written, and the reconciliation ritual exists because of
 * it.
 *
 * So the page is generated and the generation is checked. Every seat's
 * deliverable, slots, challenges, posture, escalation ladder, ceiling, and
 * licensed-review requirement is read out of the shipped modules at generation
 * time; the only prose written by hand is the framing, which makes no claim the
 * catalog could contradict. A test regenerates and compares, so a catalog edit
 * that would have quietly falsified the page fails the gate instead.
 *
 * The seat names — the human job titles — are the one mapping that cannot be
 * derived, because the whole design is that a concern is not a job title. They
 * are declared here, beside the generator that uses them, rather than smuggled
 * into the kernel where they would read as something the router knows.
 *
 * Usage:
 *   node scripts/generate-org-map.mjs           # write docs/org-map.md
 *   node scripts/generate-org-map.mjs --check    # fail if the committed file is stale
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { DOMAINS } from '../src/kernel/implication/domains.ts';
import { playbookFor } from '../src/kernel/plan/playbooks.ts';
import { lensForDomain } from '../src/kernel/plan/lenses.ts';
import { challengeById } from '../src/kernel/challenge/catalog.ts';
import { concernChallenges } from '../src/kernel/run/outcome.ts';

/**
 * Some concerns answer for no job title at all, and that is a finding rather
 * than a hole in the table below: the questions they carry are the ones that
 * fall between job descriptions, which is why nobody is assigned to ask them.
 *
 * It is declared with this marker instead of being left out, because a
 * concern nobody has classified yet and a concern nothing owns are different
 * facts, and a lookup that renders them identically cannot tell a reader
 * which one they are looking at. Every catalog domain must appear below; a
 * missing one stops the build rather than printing a placeholder.
 */
const NO_SEAT = 'no seat owns this';

/** The human seats each concern answers for. Declared, never inferred. */
const SEATS = {
  'product-scoping': 'Product manager',
  'program-sequencing': 'Program manager / TPM',
  'strategy-alignment': 'Director / VP',
  'system-design': 'Architect, tech lead, platform',
  operations: 'Support and on-call',
  'user-experience': 'Designer / UX',
  accessibility: 'Designer / UX',
  measurement: 'Data / analyst',
  security: 'Security engineer',
  privacy: 'Counsel',
  contracts: 'Counsel',
  employment: 'Counsel',
  compliance: 'Compliance',
  'commerce-tax': 'Finance / billing',
  'marketing-claims': 'Marketing',
  'evidence-provenance': NO_SEAT,
  'coverage-gaps': NO_SEAT,
};

const OUT = join('docs', 'org-map.md');

function section(domain) {
  const playbook = playbookFor(domain.domain);
  const lens = lensForDomain(domain.domain);
  // Asked of the rule the briefs actually use rather than rebuilt here: a
  // second copy of "what this concern owes" drifts the moment either moves,
  // and this page existed for a while showing neither the decision-class
  // objection nor the reader's acceptance lines that every brief carried.
  const declared = concernChallenges(domain.domain);

  const lines = [];
  const seat = SEATS[domain.domain];
  if (seat === undefined) {
    throw new Error(
      `generate-org-map: '${domain.domain}' is in the catalog with no seat declared. ` +
        'Add it to SEATS with the job title it answers for, or with NO_SEAT if none does. ' +
        'Leaving it undeclared would print a placeholder that reads like a real answer.',
    );
  }
  lines.push(`### ${seat} — \`${domain.domain}\``);
  lines.push('');
  lines.push(`**The concern.** ${domain.concern[0].toUpperCase()}${domain.concern.slice(1)}.`);
  lines.push('');
  const article = /^[aeiou]/i.test(playbook.template.deliverable) ? 'An' : 'A';
  lines.push(
    `**What it hands you.** ${article} ${playbook.template.deliverable}, with these sections ` +
      'required before the work is called finished:',
  );
  lines.push('');
  for (const slot of playbook.template.slots) {
    lines.push(`- \`${slot.name}\`${slot.required ? '' : ' *(optional)*'} — ${slot.expects}`);
  }
  lines.push('');
  lines.push('**What it must answer before anyone relies on it.**');
  lines.push('');
  for (const id of declared) {
    const challenge = challengeById(id);
    if (challenge) lines.push(`- \`${id}\` — ${challenge.question}`);
  }
  lines.push('');
  if (lens) {
    lines.push(`**Its posture.** ${lens.posture}`);
    lines.push('');
    lines.push('**What it surfaces to you rather than deciding itself.**');
    lines.push('');
    for (const step of lens.escalation) lines.push(`- ${step}`);
    lines.push('');
    if (lens.ceiling) {
      lines.push(`**Its stated limit, which is the invariant and not a gap.** ${lens.ceiling}`);
      lines.push('');
    }
  } else {
    lines.push(
      '**No lens.** This concern routes and carries the default template. It is ' +
        'listed saying so rather than implying depth it does not have.',
    );
    lines.push('');
  }
  if (domain.licensedReview) {
    lines.push(
      `**Before you rely on it.** Issue-spotting only: it needs review by a licensed ${domain.licensedReview}. ` +
        'Nothing this concern produces is advice.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

const withLens = DOMAINS.filter((d) => lensForDomain(d.domain)).length;
const seated = DOMAINS.filter((d) => SEATS[d.domain] !== undefined && SEATS[d.domain] !== NO_SEAT).length;

const page = `# The org map: which seat each concern answers for

*Generated from the catalog by \`scripts/generate-org-map.mjs\`. Do not edit by
hand — a hand-edited copy drifts from the thing it describes, and the gate
regenerates and compares.*

An organization runs on contracts nobody wrote down. Somebody always asks who
owns this when it breaks; somebody always asks what we are giving up by saying
yes; somebody always asks whether the person whose data this is could ask for it
back. Those questions are not job descriptions. They are obligations that attach
to the work, and on a small team or a fast one they get skipped — not because
anyone decided to skip them, but because the person who would have asked was not
in the room.

This is that set of obligations, made explicit and routed from your own words.
You describe an outcome; the concerns it touches are inferred; each one carries
what it owes. **You never type a role name.**

## What this page claims, and what it does not

Each entry below is generated from the shipped catalog, so it states what a
concern is *obliged* to produce — the sections that must be filled, the
challenges the deliverable must answer, the limit the concern states about
itself. That is a promise about the deliverable.

It is **not** a claim that the concern sees something the others would miss.
That claim was measured over two independently authored fixture organizations,
failed, and was withdrawn on 2026-08-10; the external record reached the same
result first. Two concerns routed at one outcome is worth having because both
obligations get answered and any disagreement between them reaches you framed —
not because each brings private sight.

Nor is it a completeness claim. Routing misses roughly three in ten of the
concerns a labeler marks implicated on wording its authors never saw. The figure
and its interval are in the README and in full in \`RESEARCH-DECISIONS.md\` §10.

${String(withLens)} of ${String(DOMAINS.length)} concerns carry a lens — a posture, an escalation
ladder, and extra required sections. The rest route and carry the default
template, and say so.

Carrying a lens and answering for a seat are different things, and the counts
differ. ${String(seated)} of ${String(DOMAINS.length)} concerns answer for a job title a human team would
recognize. The other ${String(DOMAINS.length - seated)} are marked **${NO_SEAT}**, and that is a finding
rather than a gap in this page: the questions they carry are the ones that fall
between job descriptions, which is exactly why nobody is assigned to ask them.

## The seats

${DOMAINS.map(section).join('\n')}
## The seat that is deliberately empty

There is no engineer concern. Your host is the engineer: Construct dispatches
into it, and rebuilding what a coding agent already does would be the homebrew
runtime this project's first commitment forbids. What Construct adds around it
is everything above — the concerns that would otherwise go unasked.
`;

if (process.argv.includes('--check')) {
  let committed = '';
  try {
    committed = readFileSync(OUT, 'utf8');
  } catch {
    console.error(`org-map: ${OUT} is missing — run: node scripts/generate-org-map.mjs`);
    process.exit(1);
  }
  if (committed !== page) {
    console.error(
      `org-map: ${OUT} is stale — the catalog changed and the page did not. ` +
        'Run: node scripts/generate-org-map.mjs',
    );
    process.exit(1);
  }
  console.log('org-map: current');
} else {
  writeFileSync(OUT, page);
  console.log(`org-map: wrote ${OUT} (${String(DOMAINS.length)} concerns)`);
}
