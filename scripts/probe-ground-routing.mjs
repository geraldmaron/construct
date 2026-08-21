#!/usr/bin/env node
/**
 * probe-ground-routing.mjs — does letting the declared ground inform routing
 * reach a concern the outcome's own words do not?
 *
 * A project's privacy-defining field has a name that belongs to that project,
 * and a router keyed to generic vocabulary cannot see that a domain-specific
 * identifier IS the concern. The candidate answer is that the project already
 * says what its terms mean, in the documents the run declared as its ground.
 * This measures whether that is true, and at what width it stops being true.
 *
 * The keyword router arm is deterministic — no model calls, so re-measuring
 * costs nothing. `--namer` adds the arm that path cannot speak for: the shipped
 * model namer, which is what runs in practice and what actually missed.
 *
 *   node scripts/probe-ground-routing.mjs --ground=<dir> --outcome="<text>"
 *                                         [--expect=<domain>] [--json]
 *                                         [--namer=<transport>/<model>]
 *                                         [--widths=0,1,2,4]
 *
 * The namer arm runs the shipped seam, not a stand-in: namerPrompt and
 * parseNamings from hosts/namer.ts, the one corrective retry from
 * jsonrepair.ts, and mapImplicationsNamed's catalog admission. Only the
 * transport is local to this script, following the same direct-fetch pattern
 * measure-decisions.mjs uses for its own live namer section — `ollama/<model>`
 * against the daemon named by OLLAMA_HOST, `openrouter/<vendor>/<model>`
 * against the OpenAI-compatible endpoint with OPENROUTER_API_KEY from the
 * environment and nowhere else.
 *
 * The two arms are handed the same admitted lines and frame them differently,
 * on purpose. The keyword arm concatenates, unchanged, so its table stays the
 * one already on the record. The namer arm labels the lines as the project's
 * own documents, because a namer told that a boundaries table is the user's own
 * wording is being asked a question no implementation would ask it. Compare
 * conditions within an arm; across arms, only the direction is comparable.
 *
 * `--widths` defaults to the full sweep on the keyword arm and to line scope
 * alone on the namer arm: a model call is paid per width, and the width this
 * project has decided on is the line. Pass it explicitly to measure wider.
 *
 * Exit code is 0 unless --expect names a domain no condition reaches — read on
 * the namer arm when one ran, since that is then the arm under measurement.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import { mapImplications } from '../src/kernel/implication/map.ts';
import { mapImplicationsNamed } from '../src/kernel/implication/naming.ts';
import { createHostNamer } from '../src/hosts/namer.ts';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const eq = a.indexOf('=');
    return eq === -1 ? [a.replace(/^--/, ''), 'true'] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const ground = args.get('ground');
const outcome = args.get('outcome');
const expect = args.get('expect');
const asJson = args.has('json');
const namerSpec = args.get('namer');

if (!ground || !outcome) {
  process.stderr.write(
    'usage: probe-ground-routing.mjs --ground=<dir> --outcome="<text>" [--expect=<domain>]\n' +
      '                               [--json] [--namer=<transport>/<model>] [--widths=0,1,2,4]\n',
  );
  process.exit(2);
}

/**
 * Build artifacts are on disk and are not the project's documents. A survey that
 * counts them is measuring its own noise: the BlackStory run's term appeared 143
 * times, and all but a handful were compiled output of the same few sources.
 */
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'tmp', '.turbo']);
const TEXT = new Set(['.md', '.mdx', '.txt']);
const MAX_DEPTH = 4;

function survey(dir, depth = 0, found = []) {
  if (depth > MAX_DEPTH) return found;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) survey(full, depth + 1, found);
    else if (TEXT.has(extname(name))) found.push(full);
  }
  return found;
}

/**
 * The terms in an outcome that belong to the project rather than to English:
 * snake_case, camelCase and hyphenated forms. These are the words a generic
 * keyword list cannot carry and the project's own documents can.
 */
function projectTerms(text) {
  const terms = new Set();
  for (const m of text.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/gi)) terms.add(m[0]);
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z]+)+\b/g)) terms.add(m[0]);
  for (const m of text.matchAll(/\b[a-z]+-[a-z]+\b/gi)) terms.add(m[0]);
  return [...terms];
}

/** An identifier's spaced form, so `living_status` matches prose saying "living status". */
const spacedForm = (term) =>
  term.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const documents = survey(ground);
const terms = projectTerms(outcome);

/** The ground context a term appears in, at a given half-width in lines. */
function contextAt(width) {
  const windows = [];
  for (const term of terms) {
    const forms = [term.toLowerCase(), spacedForm(term)];
    for (const file of documents) {
      let body;
      try {
        body = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].toLowerCase();
        if (!forms.some((f) => line.includes(f))) continue;
        windows.push(lines.slice(Math.max(0, i - width), i + width + 1).join('\n'));
      }
    }
  }
  return windows;
}

const parsedWidths = args.has('widths')
  ? args
      .get('widths')
      .split(',')
      .map((w) => Number(w.trim()))
      .filter((w) => Number.isInteger(w) && w >= 0)
  : null;
const WIDTHS = parsedWidths ?? [0, 1, 2, 4];
const NAMER_WIDTHS = parsedWidths ?? [0];

const label = (width) => (width === 0 ? 'the line the term sits on' : `±${String(width)} lines`);
const windowsAt = new Map([...new Set([...WIDTHS, ...NAMER_WIDTHS])].map((w) => [w, contextAt(w)]));

const alone = mapImplications({ outcome });
const rows = [
  { context: 'none (outcome alone)', width: null, domains: alone.implicated.map((i) => i.domain) },
];
for (const width of WIDTHS) {
  const windows = windowsAt.get(width);
  const result = mapImplications({ outcome: `${outcome}\n\n${windows.join('\n\n')}` });
  rows.push({
    context: label(width),
    width,
    occurrences: windows.length,
    domains: result.implicated.map((i) => i.domain),
  });
}

/**
 * The lines, presented as what they are. The keyword arm's concatenation above
 * stays byte-identical to the run already on the record; this is the namer's
 * side of the same evidence, and the difference is stated rather than hidden.
 */
const namerText = (windows) =>
  windows.length === 0
    ? outcome
    : `${outcome}\n\nLines from this project's own documents where the outcome's own terms appear:\n\n${windows.join('\n')}`;

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const OLLAMA = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

function completion(transport, model) {
  if (transport === 'ollama') {
    return async (prompt) => {
      const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, options: { temperature: 0 } }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`ollama ${String(res.status)} — is ${model} pulled?`);
      const body = await res.json();
      return body.response ?? '';
    };
  }
  if (transport === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      process.stderr.write(
        'OPENROUTER_API_KEY is not in the environment. This script reads it from there and\n' +
          'nowhere else — run under `op run --env-file=...` or the op-wrapped launch alias.\n',
      );
      process.exit(2);
    }
    // A shared free-tier pool refuses calls it is simply busy with, and an
    // answer the model was never allowed to give is not evidence about the
    // model. Waiting out a 429 is the difference between an unmeasured cell
    // and a fabricated one; the attempts are bounded so a pool that is down
    // stays reported as down.
    const BACKOFF_MS = [5000, 20000, 60000];
    return async (prompt) => {
      let res;
      let body;
      for (let attempt = 0; ; attempt += 1) {
        res = await fetch(OPENROUTER, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            // Reasoning-tuned families spend their budget before the object; a
            // reply cut off mid-JSON would be recorded as a contract failure the
            // model did not commit.
            max_tokens: 8000,
          }),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        body = await res.json();
        const throttled = res.status === 429 || body?.error?.code === 429;
        if (!throttled || attempt >= BACKOFF_MS.length) break;
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
      }
      if (!res.ok || body?.error) {
        throw new Error(`openrouter ${String(body?.error?.code ?? res.status)}: ${body?.error?.message ?? ''}`);
      }
      return body?.choices?.[0]?.message?.content ?? '';
    };
  }
  process.stderr.write(`unknown namer transport "${transport}" — use ollama or openrouter\n`);
  process.exit(2);
}

/**
 * The shipped namer over a bare transport. Everything that decides what a
 * naming means — the prompt, the parse, the one corrective retry, catalog
 * admission — comes from the modules the product runs; this object only
 * carries bytes.
 */
function transportHost(transport, model) {
  const complete = completion(transport, model);
  return {
    name: transport,
    kind: 'general',
    capabilities: [],
    model,
    init: () => Promise.resolve(),
    health: () => Promise.resolve({ live: true }),
    cancel: () => Promise.resolve({ cancelled: false }),
    invoke: async (request) => {
      const text = await complete(request.task);
      return { id: '', status: 'ok', output: { text }, error: null };
    },
  };
}

let namer = null;
if (namerSpec) {
  const slash = namerSpec.indexOf('/');
  if (slash === -1) {
    process.stderr.write('--namer takes <transport>/<model>, e.g. ollama/qwen3.6:35b\n');
    process.exit(2);
  }
  const transport = namerSpec.slice(0, slash);
  const model = namerSpec.slice(slash + 1);
  const host = transportHost(transport, model);
  const call = createHostNamer(host);
  const run = async (text) => {
    const started = Date.now();
    const named = await mapImplicationsNamed({ outcome: text, namer: call });
    return {
      domains: named.implicated.map((i) => i.domain),
      // The stated reason, kept: whether a naming cites the admitted line or
      // reaches the same domain by another route is the difference between the
      // ground doing the work and the ground being present while it happened.
      why: named.implicated.map((i) => i.signals.join(' ')),
      inferredBy: named.inferredBy,
      unmet: named.unmet.map((u) => u.proposed),
      ...(named.namerFailure ? { namerFailure: named.namerFailure } : {}),
      ...(named.namerRetriedAfter ? { namerRetriedAfter: named.namerRetriedAfter } : {}),
      ms: Date.now() - started,
    };
  };
  namer = { transport, model, rows: [{ context: 'none (outcome alone)', width: null, ...(await run(outcome)) }] };
  for (const width of NAMER_WIDTHS) {
    const windows = windowsAt.get(width);
    namer.rows.push({
      context: label(width),
      width,
      occurrences: windows.length,
      ...(await run(namerText(windows))),
    });
  }
}

// The namer is the arm under measurement whenever one ran; reading the exit
// code off the keyword arm then would report a reach the measured path never made.
const readRows = namer ? namer.rows : rows;
const reached = expect ? readRows.some((r) => r.domains.includes(expect)) : true;

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ ground, outcome, terms, documents: documents.length, rows, ...(namer ? { namer } : {}), expect, reached }, null, 2)}\n`,
  );
} else {
  const table = (arm) => {
    for (const row of arm) {
      const hit = expect ? (row.domains.includes(expect) ? `  ${expect}: yes` : `  ${expect}: no`) : '';
      process.stdout.write(
        `  ${row.context.padEnd(26)} ${String(row.domains.length).padStart(2)} domain(s)${hit}\n` +
          `      ${row.domains.join(', ') || '(nothing)'}\n` +
          (row.inferredBy && row.inferredBy !== 'namer'
            ? `      inferredBy: ${row.inferredBy}${row.namerFailure ? ` — ${row.namerFailure}` : ''}\n`
            : ''),
      );
    }
  };
  process.stdout.write(`\nground: ${String(documents.length)} document(s) under ${ground} (build artifacts excluded)\n`);
  process.stdout.write(`project terms in the outcome: ${terms.join(', ') || '(none — nothing for the ground to define)'}\n\n`);
  process.stdout.write('  keyword router\n');
  table(rows);
  if (namer) {
    process.stdout.write(`\n  model namer — ${namer.transport}/${namer.model}\n`);
    table(namer.rows);
  }
  // Precision is the thing to watch, and it is not in the domain count alone:
  // a router that names most of the catalog has answered nothing while looking
  // like it answered everything.
  process.stdout.write(
    '\n  Read as a pair. Reaching the concern is recall; the domain count is what it cost.\n' +
      '  One outcome, one model, one run — this measures a premise, not an improvement.\n\n',
  );
}

process.exit(reached ? 0 : 1);
