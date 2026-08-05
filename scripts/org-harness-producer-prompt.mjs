#!/usr/bin/env node
/**
 * org-harness-producer-prompt.mjs — emit the producer prompt for a scored run
 * over the fixture organization (fixtures/org-harness).
 *
 * The prompt is committed, not improvised: a scored run whose prompt lives
 * only in a session transcript cannot be reproduced, compared across model
 * families, or tuned with a record of what changed. This script is the one
 * source of that prompt. The role depth comes from the committed lenses
 * (src/kernel/plan/lenses.ts), so what a run was told is exactly what the
 * product's dispatches are told — the harness measures the shipped depth, not
 * a bespoke eval prompt.
 *
 * Discipline: the prompt is generically worded. It never names a planted
 * finding, a specific document, or a keyword from the answer key; it carries
 * only the role questions a practitioner would ask of any organization. The
 * answer key stays out of reach of the system under test.
 *
 * Usage:
 *   node scripts/org-harness-producer-prompt.mjs [--corpus <dir>]
 */

import process from 'node:process';
import { LENSES } from '../src/kernel/plan/lenses.ts';

const args = process.argv.slice(2);
const corpusIdx = args.indexOf('--corpus');
const corpus =
  corpusIdx >= 0 ? args[corpusIdx + 1] : 'fixtures/org-harness/corpus';

const lensBlocks = LENSES.map((l) => {
  const questions = l.questions.map((q) => `- ${q}`).join('\n');
  const ceiling = l.ceiling ? `\nCeiling: ${l.ceiling}` : '';
  return `### ${l.lens}\nPosture: ${l.posture}\n${questions}${ceiling}`;
}).join('\n\n');

const prompt = `You are performing a grounded organizational review of a fixture organization.

Your material is every file under: ${corpus}
Read all of it — the strategy document, the PRD, both RFCs, every ticket under tickets/, and both notes under notes/. Nothing outside that directory is material.

## What you produce

A single JSON object, and nothing else, in this shape:

{
  "claims": [
    { "kind": "cross-reference" | "conflict" | "risk",
      "claim": "<one finding, stated plainly, naming the mechanism>",
      "citations": ["<corpus-relative path>", ...] }
  ],
  "notesDrop": {
    "proposals": [
      { "target": "<corpus-relative ticket path>",
        "change": "<what should be recorded on that ticket>",
        "citedLine": "<the exact line from a notes/ file that justifies it>" }
    ],
    "deltas": [
      { "body": "<a decision or standing rule the notes establish that the org's records do not yet hold>",
        "citedLine": "<the exact line from a notes/ file that justifies it>" }
    ]
  }
}

Each citation is a bare corpus-relative path, exactly as the file sits on disk (for example "tickets/T-12345.md") — no line numbers, no parentheses, no annotations, nothing appended. Every claim carries at least one citation; never cite a file that does not exist; never invent content.

## How to work

The valuable findings combine two documents that never cite each other. For each claim, ask: which OTHER document changes what this one means? A ticket that looks routine next to a design document, a strategy sentence next to a spec, an incident note next to a roadmap item. Prefer claims where removing either cited document would collapse the finding.

- "cross-reference": two documents describe the same underlying thing without saying so; tie them and name the connection.
- "conflict": two commitments cannot both hold; cite both sides.
- "risk": a forward-looking exposure only visible by combining sources; name the mechanism, not a vague worry.

Use the sources; do not merely list them. Each claim states what follows from the cited documents, specific enough that a reader could verify it against the citations. Name mechanisms in the corpus's own vocabulary — the specific field, strategy, setting, or rule the documents themselves use — never a looser paraphrase. When a finding rests on two documents, cite both; a claim that names a second document in its text without citing it is an uncited claim.

## The role lenses

Work the corpus through each lens below in turn. Each lens's questions are obligations: for each one, either produce the claims it surfaces or satisfy yourself there are none. A lens that produces nothing is a conclusion you reached, not a section you skipped.

${lensBlocks}

## The notes drop

The two files under notes/ are raw brain-dump notes from team members. They contain decisions and facts the organization's records do not yet hold. Propose, for each ticket the notes bear on, what should be recorded there (proposals), and state each decision or standing rule the notes establish (deltas). Every proposal and delta quotes the exact justifying line from the notes file it came from.

Return only the JSON object.`;

process.stdout.write(prompt + '\n');
