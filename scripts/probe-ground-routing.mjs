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
 * Deterministic: the keyword router only, no model calls, so re-measuring costs
 * nothing. That is also its limit — it says nothing about the model namer, which
 * is the path that runs in practice.
 *
 *   node scripts/probe-ground-routing.mjs --ground=<dir> --outcome="<text>"
 *                                         [--expect=<domain>] [--json]
 *
 * Exit code is 0 unless --expect names a domain the widest context never reaches.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

import { mapImplications } from '../src/kernel/implication/map.ts';

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

if (!ground || !outcome) {
  process.stderr.write(
    'usage: probe-ground-routing.mjs --ground=<dir> --outcome="<text>" [--expect=<domain>] [--json]\n',
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

const WIDTHS = [0, 1, 2, 4];
const alone = mapImplications({ outcome });
const rows = [
  { context: 'none (outcome alone)', width: null, domains: alone.implicated.map((i) => i.domain) },
];
for (const width of WIDTHS) {
  const windows = contextAt(width);
  const result = mapImplications({ outcome: `${outcome}\n\n${windows.join('\n\n')}` });
  rows.push({
    context: width === 0 ? 'the line the term sits on' : `±${String(width)} lines`,
    width,
    occurrences: windows.length,
    domains: result.implicated.map((i) => i.domain),
  });
}

const reached = expect ? rows.some((r) => r.domains.includes(expect)) : true;

if (asJson) {
  process.stdout.write(`${JSON.stringify({ ground, outcome, terms, documents: documents.length, rows, expect, reached }, null, 2)}\n`);
} else {
  process.stdout.write(`\nground: ${String(documents.length)} document(s) under ${ground} (build artifacts excluded)\n`);
  process.stdout.write(`project terms in the outcome: ${terms.join(', ') || '(none — nothing for the ground to define)'}\n\n`);
  for (const row of rows) {
    const hit = expect ? (row.domains.includes(expect) ? `  ${expect}: yes` : `  ${expect}: no`) : '';
    process.stdout.write(
      `  ${row.context.padEnd(26)} ${String(row.domains.length).padStart(2)} domain(s)${hit}\n` +
        `      ${row.domains.join(', ') || '(nothing)'}\n`,
    );
  }
  // Precision is the thing to watch, and it is not in the domain count alone:
  // a router that names most of the catalog has answered nothing while looking
  // like it answered everything.
  process.stdout.write(
    '\n  Read as a pair. Reaching the concern is recall; the domain count is what it cost.\n' +
      '  One outcome and the deterministic router only — this measures a premise, not an improvement.\n\n',
  );
}

process.exit(reached ? 0 : 1);
