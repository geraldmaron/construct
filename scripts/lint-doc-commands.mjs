#!/usr/bin/env node
/**
 * lint-doc-commands.mjs — a guide may not teach a command the CLI does not have.
 *
 * Documentation drifts from the surface it documents in one direction that is
 * worse than the others: a reader copies a printed command, it errors, and the
 * tool looks broken rather than the page looking old. A walkthrough has
 * described a whole verb that no release ever shipped, and the CLI itself once
 * told a stuck user to run a command only the predecessor had. Prose is checked
 * by nobody, and a plausible-looking command reads as a verified one.
 *
 * So every `construct <verb>` a reader would copy is checked against the CLI's
 * own verb table. That table is exported from `src/cli/index.ts` and is the
 * same array the usage line is built from, which is what keeps this check
 * honest: it cannot pass by agreeing with a second copy of the truth.
 *
 * Only copyable text is in scope — shell-tagged fenced blocks, and inline spans
 * that begin with the command. Prose that happens to contain the word, output
 * transcripts, and ASCII diagrams are not commands and are not checked.
 *
 * Subcommands are checked too, against a surface measured from the CLI rather
 * than declared beside it (`lib/cli-surface.mjs`). `construct lessons list`
 * fails here, which is the line that shipped in a walkthrough and started this.
 *
 * What this still does not catch, stated so nobody reads a pass as more than it
 * is: flags. A verb's usage names them, but a documented command legitimately
 * carries flags the usage abbreviates, and failing those would train people to
 * silence the check. Verb and subcommand are checked; the argument after them
 * is not.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { INTERNAL_VERBS, VERBS } from '../src/cli/index.ts';
import { probeSurface } from './lib/cli-surface.mjs';

/**
 * Verbs the predecessor carried and this CLI does not. They are listed so a
 * page may name one as gone, which is the opposite of the failure this lint
 * exists to catch. Declared rather than tolerated: a page inventing some other
 * missing verb still fails, and a reader who greps this file learns which
 * commands are absent on purpose.
 */
const RETIRED_VERBS = new Set(['sync', 'install']);

/** Fences whose contents a reader would paste into a shell. */
const SHELL_FENCE = /^(bash|sh|shell|zsh|console)$/i;

const known = new Set([...VERBS, ...INTERNAL_VERBS]);

function docFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '*.md'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * A command line, not a sentence: `construct` opens the line, optionally behind
 * a prompt marker or a runner, then the verb, then whatever it was given.
 *
 * The trailing group matches only a bare lowercase word, so a flag, a `<id>`
 * placeholder, a quoted string, and a path are all left as undefined — none of
 * them is a subcommand, and treating one as a candidate would invent failures.
 */
const COMMAND = /(?:[$>][ \t]*)?(?:npx[ \t]+\S+[ \t]+)?construct[ \t]+([A-Za-z][\w-]*)(?:[ \t]+([a-z][a-z-]*))?/;
const COMMAND_LINE = new RegExp(`^[ \\t]*${COMMAND.source}`);

function hitsInShellFences(text) {
  const hits = [];
  for (const fence of text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)) {
    if (!SHELL_FENCE.test((fence[1] ?? '').trim())) continue;
    let cursor = fence.index + fence[0].indexOf('\n') + 1;
    for (const line of fence[2].split('\n')) {
      const found = COMMAND_LINE.exec(line);
      if (found) hits.push({ at: cursor, token: found[1], rest: found[2], text: line.trim() });
      cursor += line.length + 1;
    }
  }
  return hits;
}

function hitsInInlineSpans(text, fences) {
  const hits = [];
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    const inFence = fences.some((f) => span.index > f.at && span.index < f.at + f.body.length);
    if (inFence) continue;
    const found = new RegExp(`^${COMMAND.source}`).exec(span[1]);
    if (found) hits.push({ at: span.index, token: found[1], rest: found[2], text: span[1].trim() });
  }
  return hits;
}

const problems = [];
/** Every documented command, gathered before probing so only used verbs cost one. */
const cited = [];

for (const file of docFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('construct ')) continue;

  const fences = [...text.matchAll(/```[\s\S]*?```/g)].map((m) => ({
    at: m.index,
    body: m[0],
  }));

  for (const hit of [...hitsInShellFences(text), ...hitsInInlineSpans(text, fences)]) {
    const line = text.slice(0, hit.at).split('\n').length;
    if (!known.has(hit.token)) {
      if (RETIRED_VERBS.has(hit.token)) continue;
      problems.push({ file, line, text: hit.text, why: `names no CLI verb ('${hit.token}')` });
      continue;
    }
    cited.push({ file, line, verb: hit.token, rest: hit.rest, text: hit.text });
  }
}

// Only the verbs documentation actually uses with an argument are worth a
// process, and a verb is asked once however many pages cite it.
const needProbe = [...new Set(cited.filter((c) => c.rest !== undefined).map((c) => c.verb))];
const surface = needProbe.length > 0 ? probeSurface(needProbe) : new Map();

for (const use of cited) {
  if (use.rest === undefined) continue;
  const probed = surface.get(use.verb);
  if (!probed) continue;

  // A verb taking a free positional cannot judge the word after it, and one
  // whose surface never printed cannot judge anything. Both are skipped.
  if (probed.shape === 'positional' || probed.shape === 'unknown') continue;

  if (probed.shape === 'subcommands') {
    if (probed.subcommands.has(use.rest)) continue;
    problems.push({
      file: use.file,
      line: use.line,
      text: use.text,
      why:
        `'${use.verb}' has no '${use.rest}' subcommand ` +
        `(it accepts: ${[...probed.subcommands].sort().join(', ')})`,
    });
    continue;
  }

  // flags-only: the verb printed its own usage and named no subcommand at all,
  // so a bare word after it is one nobody can run.
  problems.push({
    file: use.file,
    line: use.line,
    text: use.text,
    why: `'${use.verb}' takes no subcommand, so '${use.rest}' is not a command`,
  });
}

if (problems.length > 0) {
  for (const p of problems) {
    process.stderr.write(`${p.file}:${p.line}: '${p.text}' — ${p.why}\n`);
  }
  process.stderr.write(
    `\nlint-doc-commands: ${String(problems.length)} documented command(s) no reader could run.\n`,
  );
  process.exit(1);
}

const judged = [...surface.values()].filter((s) => s.shape !== "unknown" && s.shape !== "positional").length;
process.stdout.write(
  `lint-doc-commands: clean — ${String(cited.length)} documented command(s) against ` +
    `${String(known.size)} verbs, ${String(judged)} of them with a surface the CLI could state\n`,
);
