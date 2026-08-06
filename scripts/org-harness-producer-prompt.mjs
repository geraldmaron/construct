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
 * Two shapes, because the product has one and the whole-roster view has one:
 *
 *   --lens <name>   ONE lens's dispatch prompt: that lens's posture, question
 *                   set, and deliverable slots as obligations, over the shared
 *                   review protocol. This is the production shape — construct
 *                   augments a host agent per dispatch, one role at a time,
 *                   and never sends every lens in one prompt. Measured runs of
 *                   the shipped artifact use this mode, one run per lens,
 *                   composed afterwards (scripts/compose-org-harness-run.mjs)
 *                   the same way the spine aggregates role deliverables.
 *   --notes         The notes-drop pass alone: proposals and deltas, with the
 *                   settled-items-only discipline.
 *   (no flag)       Every lens in one prompt. Kept for whole-roster and
 *                   cross-family comparison runs; measured to be less stable
 *                   than per-lens dispatch (obligations compete for attention
 *                   in a single pass), so pack-depth acceptance reads the
 *                   per-lens shape, not this one.
 *
 * Discipline: the prompt is generically worded. It never names a planted
 * finding, a specific document, or a keyword from the answer key; it carries
 * only the role questions a practitioner would ask of any organization. The
 * answer key stays out of reach of the system under test.
 *
 * Usage:
 *   node scripts/org-harness-producer-prompt.mjs [--corpus <dir>] [--lens <name> | --notes]
 */

import process from 'node:process';
import { LENSES } from '../src/kernel/plan/lenses.ts';

const args = process.argv.slice(2);
const corpusIdx = args.indexOf('--corpus');
const corpus =
  corpusIdx >= 0 ? args[corpusIdx + 1] : 'fixtures/org-harness/corpus';
const lensIdx = args.indexOf('--lens');
const lensName = lensIdx >= 0 ? args[lensIdx + 1] : null;
const notesMode = args.includes('--notes');

const HEADER = `You are performing a grounded organizational review of a fixture organization.

Your material is every file under: ${corpus}
Read all of it — the strategy document, the PRD, both RFCs, every ticket under tickets/, and both notes under notes/. Nothing outside that directory is material.`;

const CITATION_RULES = `Each citation is a bare corpus-relative path, exactly as the file sits on disk (for example "tickets/T-12345.md") — no line numbers, no parentheses, no annotations, nothing appended. Every claim carries at least one citation; never cite a file that does not exist; never invent content.`;

const HOW_TO_WORK = `## How to work

The valuable findings combine two documents that never cite each other. For each claim, ask: which OTHER document changes what this one means? A ticket that looks routine next to a design document, a strategy sentence next to a spec, an incident note next to a roadmap item. Prefer claims where removing either cited document would collapse the finding. A document you have already connected once is not finished: ask what ELSE it collides with — the second, less obvious connection is usually the one nobody in the organization has made.

- "cross-reference": two documents describe the same underlying thing without saying so; tie them and name the connection.
- "conflict": two commitments cannot both hold; cite both sides.
- "risk": a forward-looking exposure only visible by combining sources; name the mechanism, not a vague worry.

Use the sources; do not merely list them. Each claim states what follows from the cited documents, specific enough that a reader could verify it against the citations. Name mechanisms in the corpus's own vocabulary — the specific field, strategy, setting, or rule the documents themselves use — never a looser paraphrase. When a finding rests on two documents, cite both; a claim that names a second document in its text without citing it is an uncited claim.`;

const CLAIMS_SHAPE = `## What you produce

Your output is a single JSON object, and nothing else, in this shape:

{
  "claims": [
    { "kind": "cross-reference" | "conflict" | "risk",
      "claim": "<one finding, stated plainly, naming the mechanism>",
      "citations": ["<corpus-relative path>", ...] }
  ]
}

${CITATION_RULES}`;

const NOTES_SHAPE = `## What you produce

Your output is a single JSON object, and nothing else, in this shape:

{
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

${CITATION_RULES.replace('Every claim carries at least one citation; never', 'Never')}`;

const NOTES_DISCIPLINE = `## The notes drop

The two files under notes/ are raw brain-dump notes from team members. They contain decisions and facts the organization's records do not yet hold. Propose, for each ticket the notes bear on, what should be recorded there (proposals), and state each decision or standing rule the notes establish (deltas). Every proposal and delta quotes the exact justifying line from the notes file it came from — quote the line verbatim, whole.

A delta records what the notes SETTLED, and only that. Notes also carry items that were explicitly parked, deferred to an owner, or raised and left undecided — those are not decisions, and writing one up as a delta records a resolution the organization never reached. Where the notes park something or say a question needs an owner, that is not yours to record as decided; leave it out of the deltas entirely. Before writing each delta, point at the words in the note that make it settled; if the words say "parking that", "needs an owner", "not deciding here", or anything of that shape, it is not a delta.`;

function lensBlock(l) {
  const questions = l.questions.map((q) => `- ${q}`).join('\n');
  const ceiling = l.ceiling ? `\nCeiling: ${l.ceiling}` : '';
  return `### ${l.lens}\nPosture: ${l.posture}\n${questions}${ceiling}`;
}

/** One lens's dispatch: its questions are the whole obligation set. */
function singleLensPrompt(l) {
  const slots = l.slots
    .map((s) => `- ${s.name}: ${s.expects}`)
    .join('\n');
  return `${HEADER}

You are dispatched as the ${l.lens} role, and only that role. Other reviews cover the other concerns; anything outside your lens is someone else's finding, and chasing it costs you the depth you were dispatched for.

${CLAIMS_SHAPE}

${HOW_TO_WORK}

## Your lens

${lensBlock(l)}

Every question above is an obligation on its own: for EACH question, either produce the claims it surfaces or satisfy yourself there are none — and treat the questions as independent, not as one theme. A question answered by pointing at another question's finding is a question you have not worked.

Your deliverable must fill these slots, expressed as claims:
${slots}

Work the whole corpus under this one lens before writing. Depth over breadth: three findings with both documents cited and the mechanism named beat ten observations.

Return only the JSON object.`;
}

let prompt;
if (notesMode) {
  prompt = `${HEADER}

${NOTES_SHAPE}

${NOTES_DISCIPLINE}

Return only the JSON object.`;
} else if (lensName) {
  const lens = LENSES.find((l) => l.lens === lensName);
  if (!lens) {
    console.error(
      `unknown lens "${lensName}" — one of: ${LENSES.map((l) => l.lens).join(', ')}`,
    );
    process.exit(2);
  }
  prompt = singleLensPrompt(lens);
} else {
  const lensBlocks = LENSES.map(lensBlock).join('\n\n');
  prompt = `${HEADER}

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

${CITATION_RULES}

${HOW_TO_WORK}

## The role lenses

Work the corpus through each lens below in turn. Each lens's questions are obligations: for each one, either produce the claims it surfaces or satisfy yourself there are none. A lens that produces nothing is a conclusion you reached, not a section you skipped.

${lensBlocks}

${NOTES_DISCIPLINE}

Return only the JSON object.`;
}

process.stdout.write(prompt + '\n');
