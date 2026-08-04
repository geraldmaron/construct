#!/usr/bin/env node
// Drives ONE coder sheet through a local ollama model, as an independent coder
// in the construct-2jb.3 agreement study.
//
// WHY THIS EXISTS, AND WHAT IT IS NOT
//
// The study needs >= 2 coders whose errors are not correlated. Gerald's accepted
// protocol (see `bd show construct-2jb.3`) is: an LLM coder labels one sheet in a
// fresh isolated session, Gerald is the second coder, alpha is computed between
// them. The correlated-error caveat on that protocol is specific and load-bearing:
// an LLM coder from the family that AUTHORED the domain catalog shares its blind
// spots, so observed alpha is an UPPER bound on true independent agreement.
//
// This script exists to weaken that caveat, not to remove it, by running a coder
// from a DIFFERENT model family (a local open-weight model) that had no hand in
// authoring the catalog. That is a genuine reduction in correlated error. It is
// NOT a substitute for a human coder, and it introduces a confound of its own:
//
//   A LOW alpha from this coder is AMBIGUOUS. It cannot distinguish "the labeling
//   task is genuinely ambiguous" (the thing the study wants to measure) from "this
//   model is not competent at the task" (a fact about the coder, not the task).
//   A HIGH alpha is the informative direction: two systems with different training
//   agreeing implies the task has a stable answer, so annotation ambiguity is not
//   what is holding the miss rate above target.
//
// Report both directions with that asymmetry stated. Never quote alpha from this
// coder as "the human disagreement floor" — it is not one, and construct-2jb.3
// does not close on it.
//
// Usage:
//   node scripts/labeling-kit/code-sheet-with-model.mjs <coder-name> <ollama-model>

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const [coder, model] = process.argv.slice(2);
if (!coder || !model) {
  console.error('usage: code-sheet-with-model.mjs <coder-name> <ollama-model>');
  process.exit(2);
}

const sheetPath = join(HERE, 'sheets', `${coder}.json`);
const outPath = join(HERE, 'returned', `${coder}.json`);
const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'));

// The coder sees exactly what a human coder sees: the catalog's plain-English
// concern lines and the outcome text. No keywords, no source, no other coder's
// answers, no expectation field (generate-sheets.mjs strips those).
const catalogText = sheet.catalog
  .map((d) => `- ${d.domain}: ${d.concern}`)
  .join('\n');

function promptFor(outcome) {
  return `You are labeling outcomes for a study of how people judge which domains an outcome touches.

The domains you may choose from, and what each covers:
${catalogText}

Read this outcome and decide which domains (zero or more) it implicates:

"${outcome}"

Judge as a careful person would, from the plain English of the outcome and the plain English of each domain's concern. An outcome may touch more than one domain; do not force a single answer and do not pad the list to hedge. If none genuinely apply, answer with an empty list.

Reply with ONLY a JSON array of domain names, e.g. ["privacy"] or ["privacy","contracts"] or []. No prose, no explanation, no code fence.`;
}

const valid = new Set(sheet.catalog.map((d) => d.domain));

function parseLabels(raw) {
  // Models wrap JSON in prose or fences despite instructions. Recover the array
  // rather than discarding the answer, but never invent one: an unparseable reply
  // throws, and the run stops with the sheet incomplete.
  const text = String(raw).trim();
  const match = text.match(/\[[^\]]*\]/s);
  if (!match) throw new Error(`no JSON array in reply: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error(`not an array: ${match[0]}`);
  const cleaned = [...new Set(parsed.map((s) => String(s).trim().toLowerCase()))];
  const unknown = cleaned.filter((d) => !valid.has(d));
  if (unknown.length) throw new Error(`off-catalog labels: ${unknown.join(', ')}`);
  return cleaned;
}

async function ask(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      // Deterministic: this is a measurement, and a coder that answers differently
      // on a re-run cannot be audited.
      options: { temperature: 0, seed: 7 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.response;
}

const started = new Date().toISOString();
let done = 0;
for (const item of sheet.outcomes) {
  const reply = await ask(promptFor(item.outcome));
  item.labels = parseLabels(reply);
  done += 1;
  process.stderr.write(
    `  ${String(done).padStart(2)}/${sheet.outcomes.length}  ${item.id.padEnd(14)} ${JSON.stringify(item.labels)}\n`,
  );
}

sheet.codedBy = {
  kind: 'model',
  model,
  via: 'ollama',
  temperature: 0,
  seed: 7,
  started,
  finished: new Date().toISOString(),
  caveat:
    'Model coder from a different family than the catalog author. Reduces but does not remove correlated error; a LOW alpha here cannot distinguish task ambiguity from coder incompetence. Not a human coder and not a close gate for construct-2jb.3.',
};

writeFileSync(outPath, `${JSON.stringify(sheet, null, 2)}\n`);
console.log(`\nwrote ${outPath} (${sheet.outcomes.length} outcomes, model ${model})`);
