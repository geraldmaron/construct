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
// TWO KINDS OF DIVERSITY, AND ONLY ONE OF THEM COUNTS HERE.
// Choosing a bigger or smaller model from the same vendor changes capability and
// cost; it does not change correlated error, because the caveat above is about
// shared pretraining and survives a tier change untouched. Only a different
// FAMILY moves that number. That is why this script takes a provider and a
// model rather than a size: the point is whose weights answer, not how many.
//
// Usage:
//   node scripts/labeling-kit/code-sheet-with-model.mjs <coder-name> <model>
//   node scripts/labeling-kit/code-sheet-with-model.mjs <coder-name> <model> \
//     [--provider ollama|openrouter] [--corpus <path-to-fixture>]
//
// --corpus codes a corpus fixture (tests/kernel/implication/fixtures/*.json)
// instead of a prepared sheet, so a corpus built by one family can be re-coded
// by another without a second script. --provider openrouter reads
// OPENROUTER_API_KEY from the environment and nowhere else: no file, no prompt,
// no argument. A key that is not in the environment is a key this script does
// not have.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const [coder, model] = positional;
const provider = flag('provider') ?? 'ollama';
const corpusPath = flag('corpus');

if (!coder || !model) {
  console.error(
    'usage: code-sheet-with-model.mjs <coder-name> <model> [--provider ollama|openrouter] [--corpus <fixture>]',
  );
  process.exit(2);
}
if (!['ollama', 'openrouter'].includes(provider)) {
  console.error(`unknown provider "${provider}" — expected ollama or openrouter`);
  process.exit(2);
}
if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
  // Fail before the first call rather than as an opaque 401 forty outcomes in.
  console.error(
    'OPENROUTER_API_KEY is not in the environment. This script reads it from there and nowhere\n' +
      'else. Launch through the op-wrapped `claude` alias, or run under `op run --env-file=...`.',
  );
  process.exit(78);
}

// Corpus coding lands in its own directory. `returned/` is construct-2jb.3's
// study — compute-alpha.mjs pools everything it finds there, and a 72-outcome
// panel sheet dropped in beside a 34-outcome study sheet would change what that
// study reports without anyone editing it.
const outPath = join(HERE, corpusPath ? 'returned-panel' : 'returned', `${coder}.json`);

/** A prepared sheet, or a corpus fixture reshaped into one. */
function loadWork() {
  if (!corpusPath) return JSON.parse(readFileSync(join(HERE, 'sheets', `${coder}.json`), 'utf8'));

  const corpus = JSON.parse(readFileSync(resolve(corpusPath), 'utf8'));
  // The seal, checked by what the file says about itself rather than by its
  // name — naming it here would itself be the violation corpus-split.test.ts
  // watches for.
  if (String(corpus.partition ?? '').startsWith('SEALED')) {
    console.error(
      `${corpusPath} declares itself sealed. Coding it is scoring it, and that is a decision with\n` +
        'a date and a reason (see construct-2jb notes), not something a runner does in passing.',
    );
    process.exit(2);
  }
  return {
    // The coder sees the catalog's plain-English concerns only — never the
    // keywords, never the existing labels.
    catalog: DOMAINS.map((d) => ({ domain: d.domain, concern: d.concern })),
    source: corpusPath,
    outcomes: corpus.outcomes.map((o) => ({ id: o.id, outcome: o.outcome })),
  };
}

const sheet = loadWork();

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

// Both providers are asked at temperature 0. This is a measurement, and a coder
// that answers differently on a re-run cannot be audited. (Seeding is honoured
// by ollama; hosted providers generally do not promise it, so an OpenRouter
// coder is reproducible only as far as its host makes it so — stated here
// rather than assumed away.)
async function askOllama(prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0, seed: 7 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).response;
}

async function askOpenRouter(prompt) {
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error(`no message content: ${JSON.stringify(body).slice(0, 200)}`);
  return text;
}

const ask = provider === 'openrouter' ? askOpenRouter : askOllama;

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
  via: provider,
  temperature: 0,
  ...(provider === 'ollama' ? { seed: 7 } : {}),
  started,
  finished: new Date().toISOString(),
  caveat:
    'Model coder from a different family than the catalog author. Reduces but does not remove correlated error; a LOW alpha here cannot distinguish task ambiguity from coder incompetence. Not a human coder and not a close gate for construct-2jb.3.',
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(sheet, null, 2)}\n`);
console.log(`\nwrote ${outPath} (${sheet.outcomes.length} outcomes, model ${model})`);
